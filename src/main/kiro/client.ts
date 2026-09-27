/**
 * Kiro model API client (pure Node): GenerateAssistantResponse streaming,
 * ListAvailableModels, ListAvailableProfiles, GetUsageLimits.
 *
 * The wire protocol is the CodeWhisperer / Amazon Q streaming service; the
 * response is an AWS event-stream whose JSON payloads are normalized here
 * into text / tool-use / usage events.
 */

import { randomUUID } from 'crypto'
import { EventStreamDecoder } from './eventStream'
import { KiroAuth, KiroAuthError, type KiroAccess } from './auth'

export type KiroEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolUse'; id: string; name: string; input: Record<string, unknown>; parseError?: string }
  | { type: 'usage'; contextUsagePercentage?: number; inputTokens?: number; outputTokens?: number; credits?: number }
  | { type: 'error'; message: string; status?: number; transient: boolean; code?: string }

export interface KiroModelInfo {
  modelId: string
  modelName?: string
  description?: string
  maxInputTokens?: number
  maxOutputTokens?: number
  supportsImages?: boolean
  rateMultiplier?: number
}

export class KiroApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean,
    readonly code?: string
  ) {
    super(message)
  }
}

type FetchFn = typeof fetch
const STREAM_TARGET = 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse'
const SERVICE = 'AmazonCodeWhispererService'
const ORIGIN = 'AI_EDITOR'

function userAgent(version: string): string {
  return `aws-sdk-js/1.0.27 ua/2.1 os/${process.platform} lang/js md/nodejs#${process.versions.node} api/codewhispererstreaming#1.0.27 m/E Pawn/${version}`
}

interface Endpoint {
  url: string
  /** Service-root endpoints route by X-Amz-Target only. */
  root: boolean
  needsProfile: boolean
}

/** Candidate chat endpoints, most preferred first. */
export function chatEndpoints(access: KiroAccess): Endpoint[] {
  const r = access.region
  if (access.kind === 'api-key') return [{ url: `https://q.${r}.amazonaws.com/`, root: true, needsProfile: false }]
  const list: Endpoint[] = [{ url: `https://q.${r}.amazonaws.com/generateAssistantResponse`, root: false, needsProfile: false }]
  if (access.profileArn) list.push({ url: `https://runtime.${r}.kiro.dev/generateAssistantResponse`, root: false, needsProfile: true })
  if (r === 'us-east-1') list.push({ url: 'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse', root: false, needsProfile: false })
  return list
}

export function kiroHeaders(access: KiroAccess, target: string, version: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.0',
    Accept: 'application/json',
    Authorization: `Bearer ${access.token}`,
    'X-Amz-Target': target,
    'x-amzn-codewhisperer-optout': 'true',
    'x-amzn-kiro-agent-mode': 'vibe',
    'amz-sdk-invocation-id': randomUUID(),
    'amz-sdk-request': 'attempt=1; max=1',
    'User-Agent': userAgent(version),
    'x-amz-user-agent': `aws-sdk-js/1.0.27 Pawn/${version}`
  }
  if (access.kind === 'api-key') h.tokentype = 'API_KEY'
  return h
}

function errorMessage(status: number, text: string): { message: string; code?: string } {
  let code: string | undefined
  let msg = text.slice(0, 400)
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    code = String(j.reason || j.__type || j.code || '').split('#').pop() || undefined
    msg = String(j.message || j.Message || j.error || msg)
  } catch {
    /* plain text */
  }
  if (status === 403 && /expired|invalid.*token|bearer token/i.test(msg)) msg = `Kiro rejected the credentials (${msg}).`
  if (/MONTHLY_REQUEST_COUNT/.test(`${code} ${msg}`)) msg = `Kiro monthly credit limit reached (${msg}).`
  return { message: `Kiro API ${status}${code ? ` ${code}` : ''}: ${msg}`, code }
}

function isTransient(status: number, code?: string): boolean {
  if (/MONTHLY_REQUEST_COUNT/.test(code || '')) return false
  return status === 429 || status >= 500 || /INSUFFICIENT_MODEL_CAPACITY|Throttl/i.test(code || '')
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((r) => {
    const t = setTimeout(r, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      r()
    }, { once: true })
  })

export class KiroClient {
  /** Working chat endpoint per region+kind (learned on first success). */
  private preferred = new Map<string, string>()

  constructor(
    private readonly auth: KiroAuth,
    private readonly opts: { fetch?: FetchFn; version?: string } = {}
  ) {}

  private get fetchFn(): FetchFn {
    return this.opts.fetch ?? fetch
  }

  private get version(): string {
    return this.opts.version || '1'
  }

  /** Non-streaming service call (models, profiles). */
  private async service(op: string, body: Record<string, unknown>, access?: KiroAccess): Promise<Record<string, any>> {
    let a = access ?? (await this.auth.access())
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchFn(`https://q.${a.region}.amazonaws.com/`, {
        method: 'POST',
        headers: kiroHeaders(a, `${SERVICE}.${op}`, this.version),
        body: JSON.stringify(body)
      })
      const text = await res.text()
      if (res.ok) return text ? (JSON.parse(text) as Record<string, any>) : {}
      if (res.status === 403 && attempt === 0 && a.kind === 'bearer') {
        a = await this.auth.access({ forceRefresh: true }).catch(() => a)
        continue
      }
      const e = errorMessage(res.status, text)
      throw new KiroApiError(e.message, res.status, isTransient(res.status, e.code), e.code)
    }
    throw new KiroApiError(`Kiro ${op} failed`, 0, true)
  }

  async listModels(): Promise<KiroModelInfo[]> {
    const access = await this.auth.access()
    const out: KiroModelInfo[] = []
    let nextToken: string | undefined
    for (let page = 0; page < 10; page++) {
      const body: Record<string, unknown> = { origin: ORIGIN }
      if (access.profileArn && access.kind === 'bearer') body.profileArn = access.profileArn
      if (nextToken) body.nextToken = nextToken
      const res = await this.service('ListAvailableModels', body, access)
      for (const m of (res.models || []) as Array<Record<string, any>>) {
        if (!m?.modelId) continue
        out.push({
          modelId: String(m.modelId),
          ...(m.modelName ? { modelName: String(m.modelName) } : {}),
          ...(m.description ? { description: String(m.description).slice(0, 300) } : {}),
          ...(m.tokenLimits?.maxInputTokens ? { maxInputTokens: Number(m.tokenLimits.maxInputTokens) } : {}),
          ...(m.tokenLimits?.maxOutputTokens ? { maxOutputTokens: Number(m.tokenLimits.maxOutputTokens) } : {}),
          supportsImages: Array.isArray(m.supportedInputTypes) && m.supportedInputTypes.includes('IMAGE'),
          ...(typeof m.rateMultiplier === 'number' ? { rateMultiplier: m.rateMultiplier } : {})
        })
      }
      nextToken = typeof res.nextToken === 'string' && res.nextToken ? res.nextToken : undefined
      if (!nextToken) break
    }
    return out
  }

  async listProfiles(): Promise<Array<{ arn: string; name?: string; region?: string }>> {
    const res = await this.service('ListAvailableProfiles', {})
    return ((res.profiles || []) as Array<Record<string, any>>)
      .filter((p) => typeof p.arn === 'string')
      .map((p) => ({ arn: p.arn, ...(p.profileName ? { name: String(p.profileName) } : {}), ...(p.region ? { region: String(p.region) } : {}) }))
  }

  /** Remaining credits, when the service reports them (best effort). */
  async usage(): Promise<{ used?: number; limit?: number; resetAt?: string; raw?: unknown } | null> {
    const a = await this.auth.access()
    const qs = new URLSearchParams({ origin: ORIGIN, resourceType: 'AGENTIC_REQUEST', ...(a.profileArn && a.kind === 'bearer' ? { profileArn: a.profileArn } : {}) })
    const h = kiroHeaders(a, '', this.version)
    delete h['X-Amz-Target']
    const res = await this.fetchFn(`https://q.${a.region}.amazonaws.com/getUsageLimits?${qs}`, { method: 'GET', headers: h })
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as Record<string, any> | null
    if (!j) return null
    const b = Array.isArray(j.usageBreakdownList) ? j.usageBreakdownList[0] : j
    const used = Number(b?.currentUsageWithPrecision ?? b?.currentUsage ?? b?.usedCount)
    const limit = Number(b?.usageLimitWithPrecision ?? b?.usageLimit ?? b?.limitCount)
    return {
      ...(Number.isFinite(used) ? { used } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(typeof j.nextDateReset === 'string' || typeof j.nextDateReset === 'number' ? { resetAt: String(j.nextDateReset) } : {}),
      raw: j
    }
  }

  /**
   * Stream one GenerateAssistantResponse call. `body` is the full request
   * (conversationState …); profileArn / agent fields are added per endpoint.
   */
  async *chat(body: Record<string, any>, signal?: AbortSignal): AsyncGenerator<KiroEvent> {
    let access = await this.auth.access()
    let refreshed = false
    let transientTries = 0
    const candidates = (): Endpoint[] => {
      const list = chatEndpoints(access)
      const pref = this.preferred.get(`${access.kind}:${access.region}`)
      return pref ? [...list.filter((e) => e.url === pref), ...list.filter((e) => e.url !== pref)] : list
    }
    let endpoints = candidates()
    for (let i = 0; i < endpoints.length; ) {
      const ep = endpoints[i]
      const payload: Record<string, any> = { ...body }
      if (access.kind === 'api-key') {
        payload.conversationState = { ...payload.conversationState, agentTaskType: 'vibe' }
        payload.agentMode = 'vibe'
      } else if (access.profileArn) {
        payload.profileArn = access.profileArn
      } else if (ep.needsProfile) {
        i++
        continue
      }
      let res: Response
      try {
        res = await this.fetchFn(ep.url, {
          method: 'POST',
          headers: kiroHeaders(access, STREAM_TARGET, this.version),
          body: JSON.stringify(payload),
          signal
        })
      } catch (err) {
        if (signal?.aborted) throw err
        if (transientTries++ < 2) {
          await sleep(800 * transientTries, signal)
          continue
        }
        throw new KiroApiError(`Could not reach Kiro (${new URL(ep.url).host}): ${err instanceof Error ? err.message : String(err)}`, 0, true)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const e = errorMessage(res.status, text)
        if ((res.status === 401 || res.status === 403) && !refreshed && access.kind === 'bearer') {
          refreshed = true
          try {
            access = await this.auth.access({ forceRefresh: true })
          } catch (err) {
            throw new KiroApiError(err instanceof KiroAuthError ? err.message : e.message, res.status, false, e.code)
          }
          endpoints = candidates()
          i = 0
          continue
        }
        // Wrong endpoint for this account / region → try the next one.
        if ((res.status === 404 || /UnknownOperation|not.?found/i.test(`${e.code} ${text.slice(0, 200)}`)) && i < endpoints.length - 1) {
          i++
          continue
        }
        if (isTransient(res.status, e.code) && transientTries++ < 2) {
          const after = Number(res.headers.get('retry-after'))
          await sleep(Number.isFinite(after) && after > 0 ? Math.min(20_000, after * 1000) : 1500 * 2 ** (transientTries - 1), signal)
          continue
        }
        throw new KiroApiError(e.message, res.status, isTransient(res.status, e.code), e.code)
      }
      this.preferred.set(`${access.kind}:${access.region}`, ep.url)
      yield* this.readStream(res, signal)
      return
    }
    throw new KiroApiError('No Kiro endpoint accepted the request (a profile ARN may be required — sign in again).', 400, false)
  }

  private async *readStream(res: Response, signal?: AbortSignal): AsyncGenerator<KiroEvent> {
    const reader = res.body?.getReader()
    if (!reader) throw new KiroApiError('Kiro returned no response body', 502, true)
    const decoder = new EventStreamDecoder()
    const dec = new TextDecoder()
    let tool: { id: string; name: string; input: string } | null = null
    const finishTool = (): KiroEvent | null => {
      if (!tool) return null
      const t = tool
      tool = null
      const raw = t.input.trim()
      if (!raw) return { type: 'toolUse', id: t.id, name: t.name, input: {} }
      try {
        const v = JSON.parse(raw)
        return { type: 'toolUse', id: t.id, name: t.name, input: v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v } }
      } catch (err) {
        return { type: 'toolUse', id: t.id, name: t.name, input: {}, parseError: `${err instanceof Error ? err.message : String(err)} — raw: ${raw.slice(0, 300)}` }
      }
    }
    try {
      for (;;) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const { done, value } = await reader.read()
        if (done) break
        for (const msg of decoder.push(value)) {
          const kind = String(msg.headers[':message-type'] || 'event')
          const type = String(msg.headers[':event-type'] || msg.headers[':exception-type'] || '')
          const text = dec.decode(msg.payload)
          let j: Record<string, any> = {}
          try {
            j = text ? JSON.parse(text) : {}
          } catch {
            j = { raw: text }
          }
          if (kind === 'exception' || kind === 'error') {
            const code = String(msg.headers[':exception-type'] || msg.headers[':error-code'] || type || 'error')
            yield {
              type: 'error',
              message: `Kiro stream ${code}: ${String(j.message || j.Message || msg.headers[':error-message'] || text).slice(0, 400)}`,
              transient: /Throttl|ServiceUnavailable|InternalServer|CAPACITY/i.test(`${code} ${text}`),
              code
            }
            continue
          }
          if (type === 'assistantResponseEvent' || (!type && typeof j.content === 'string')) {
            if (typeof j.content === 'string' && j.content) yield { type: 'text', text: j.content }
          } else if (type === 'reasoningContentEvent') {
            const t = j.text ?? j.reasoningText ?? j.content
            if (typeof t === 'string' && t) yield { type: 'reasoning', text: t }
          } else if (type === 'toolUseEvent' || (!type && (j.toolUseId || j.name || 'input' in j || 'stop' in j))) {
            const cur = tool as { id: string; name: string; input: string } | null
            const id: string | undefined = typeof j.toolUseId === 'string' ? j.toolUseId : cur?.id
            if (id && (!tool || tool.id !== id)) {
              const prev = finishTool()
              if (prev) yield prev
              tool = { id, name: String(j.name || ''), input: '' }
            }
            if (tool) {
              if (j.name && !tool.name) tool.name = String(j.name)
              if (typeof j.input === 'string') tool.input += j.input
              else if (j.input && typeof j.input === 'object') tool.input = JSON.stringify(j.input)
              if (j.stop === true) {
                const ev = finishTool()
                if (ev) yield ev
              }
            }
          } else if (type === 'contextUsageEvent' || typeof j.contextUsagePercentage === 'number') {
            yield { type: 'usage', contextUsagePercentage: Number(j.contextUsagePercentage) }
          } else if (type === 'meteringEvent' || j.usage !== undefined) {
            const u = j.usage
            if (u && typeof u === 'object') {
              yield { type: 'usage', ...(Number.isFinite(Number(u.inputTokens)) ? { inputTokens: Number(u.inputTokens) } : {}), ...(Number.isFinite(Number(u.outputTokens)) ? { outputTokens: Number(u.outputTokens) } : {}) }
            } else if (Number.isFinite(Number(u))) {
              yield { type: 'usage', credits: Number(u) }
            }
          } else if (type === 'invalidStateEvent') {
            yield { type: 'error', message: `Kiro: ${String(j.message || j.reason || 'invalid state')}`, transient: false, code: 'invalidStateEvent' }
          }
          // messageMetadataEvent / followupPromptEvent / codeReferenceEvent: ignored.
        }
      }
      const last = finishTool()
      if (last) yield last
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* closed */
      }
    }
  }
}
