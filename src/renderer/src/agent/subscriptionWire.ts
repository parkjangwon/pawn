/**
 * Request rewrite for subscription sign-in.
 *
 * ChatGPT (Codex) speaks the Responses API at chatgpt.com. Antigravity speaks
 * Cloud Code generateContent. Claude keeps the Messages API and only swaps
 * the API key for a bearer token plus the oauth beta header.
 */

export type SubscriptionKind = 'chatgpt' | 'claude' | 'antigravity'

export interface SubscriptionAuth {
  kind: SubscriptionKind
  accountId?: string
  projectId?: string
}

export const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20'

export interface WireSink {
  text(delta: string): void
  reasoning(delta: string): void
  tool(call: { id: string; name: string; arguments: Record<string, unknown> }): void
  usage(partial: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }): void
  error(message: string): void
}

function hostOf(baseUrl: string | undefined | null): string {
  if (!baseUrl) return ''
  try {
    return new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isChatGptCodexBase(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`)
    return u.hostname.toLowerCase() === 'chatgpt.com' && u.pathname.includes('/backend-api/codex')
  } catch {
    return false
  }
}

export function isClaudeApiBase(baseUrl: string | undefined | null): boolean {
  return hostOf(baseUrl) === 'api.anthropic.com'
}

export function isAntigravityBase(baseUrl: string | undefined | null): boolean {
  const host = hostOf(baseUrl)
  return host === 'cloudcode-pa.googleapis.com' || host === 'daily-cloudcode-pa.googleapis.com'
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('')
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return { __parse_error: true, __raw: raw.slice(0, 500), __message: 'Tool arguments were not a JSON object' }
  } catch (err) {
    return {
      __parse_error: true,
      __raw: raw.slice(0, 500),
      __message: err instanceof Error ? err.message : 'Invalid tool argument JSON'
    }
  }
}

function responsesUserContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') return content ? [{ type: 'input_text', text: content }] : []
  if (!Array.isArray(content)) return []
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const row = part as { type?: string; text?: string; image_url?: { url?: string } | string }
    if ((row.type === 'text' || row.type === 'input_text') && typeof row.text === 'string' && row.text) {
      parts.push({ type: 'input_text', text: row.text })
    } else if (row.type === 'image_url') {
      const url = typeof row.image_url === 'string' ? row.image_url : row.image_url?.url
      if (url) parts.push({ type: 'input_image', image_url: url })
    }
  }
  return parts
}

function openAiTools(tools: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(tools)) return []
  const out: Array<Record<string, unknown>> = []
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue
    const row = tool as { type?: string; function?: { name?: string; description?: string; parameters?: unknown }; name?: string; description?: string; parameters?: unknown }
    const fn = row.function
    const name = fn?.name || row.name
    if (!name) continue
    out.push({
      type: 'function',
      name,
      description: fn?.description || row.description || '',
      parameters: fn?.parameters || row.parameters || { type: 'object', properties: {} }
    })
  }
  return out
}

/** OpenAI chat-completions body → Codex Responses body. */
export function chatCompletionsToResponses(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const instructions: string[] = []
  const input: Array<Record<string, unknown>> = []
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const msg = raw as { role?: string; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown }
    if (msg.role === 'system') {
      const text = textOf(msg.content)
      if (text) instructions.push(text)
      continue
    }
    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(msg.tool_call_id || ''),
        output: textOf(msg.content)
      })
      continue
    }
    if (msg.role === 'assistant') {
      const text = textOf(msg.content)
      if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] })
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
      for (const call of calls) {
        if (!call || typeof call !== 'object') continue
        const c = call as { id?: string; function?: { name?: string; arguments?: string } }
        input.push({
          type: 'function_call',
          call_id: String(c.id || ''),
          name: String(c.function?.name || ''),
          arguments: String(c.function?.arguments || '{}')
        })
      }
      continue
    }
    const content = responsesUserContent(msg.content)
    if (content.length) input.push({ role: 'user', content })
  }
  const tools = openAiTools(body.tools)
  const out: Record<string, unknown> = { model: body.model, input, store: false }
  if (instructions.length) out.instructions = instructions.join('\n\n')
  if (tools.length) out.tools = tools
  if (typeof body.max_tokens === 'number') out.max_output_tokens = body.max_tokens
  out.stream = body.stream === true
  if (typeof body.reasoning_effort === 'string' && body.reasoning_effort && body.reasoning_effort !== 'auto') {
    out.reasoning = { effort: body.reasoning_effort }
  }
  return out
}

function geminiParts(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') return content ? [{ text: content }] : []
  if (!Array.isArray(content)) return []
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const row = part as { type?: string; text?: string; image_url?: { url?: string } | string }
    if ((row.type === 'text' || row.type === undefined) && typeof row.text === 'string' && row.text) {
      parts.push({ text: row.text })
    } else if (row.type === 'image_url') {
      const url = typeof row.image_url === 'string' ? row.image_url : row.image_url?.url
      const match = url ? /^data:([^;]+);base64,(.+)$/i.exec(url) : null
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
    }
  }
  return parts
}

/** OpenAI chat-completions body → Cloud Code generateContent body. */
export function chatCompletionsToAntigravity(body: Record<string, unknown>, projectId: string | undefined): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system: string[] = []
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = []
  const names = new Map<string, string>()
  const push = (role: 'user' | 'model', parts: Array<Record<string, unknown>>): void => {
    if (!parts.length) return
    const prev = contents[contents.length - 1]
    if (prev && prev.role === role) prev.parts.push(...parts)
    else contents.push({ role, parts })
  }
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const msg = raw as { role?: string; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown }
    if (msg.role === 'system') {
      const text = textOf(msg.content)
      if (text) system.push(text)
      continue
    }
    if (msg.role === 'tool') {
      const id = String(msg.tool_call_id || '')
      const name = names.get(id) || 'tool'
      push('user', [{
        functionResponse: {
          name,
          id,
          response: { output: textOf(msg.content) }
        }
      }])
      continue
    }
    if (msg.role === 'assistant') {
      const parts = geminiParts(msg.content)
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
      for (const call of calls) {
        if (!call || typeof call !== 'object') continue
        const c = call as { id?: string; function?: { name?: string; arguments?: string } }
        const id = String(c.id || '')
        const name = String(c.function?.name || '')
        if (id && name) names.set(id, name)
        let args: Record<string, unknown> = {}
        try {
          const parsed = JSON.parse(c.function?.arguments || '{}') as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
        } catch {
          args = {}
        }
        parts.push({ functionCall: { name, id, args } })
      }
      push('model', parts)
      continue
    }
    push('user', geminiParts(msg.content))
  }
  const request: Record<string, unknown> = { contents }
  if (system.length) request.systemInstruction = { parts: [{ text: system.join('\n\n') }] }
  if (typeof body.max_tokens === 'number') request.generationConfig = { maxOutputTokens: body.max_tokens }
  const declarations = openAiTools(body.tools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }))
  if (declarations.length) request.tools = [{ functionDeclarations: declarations }]
  return {
    project: projectId || '',
    model: body.model,
    request
  }
}

function codexResponsesUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/responses$/, '')
  return `${base}/responses`
}

function antigravityEndpoint(baseUrl: string, stream: boolean): string {
  const host = hostOf(baseUrl) || 'cloudcode-pa.googleapis.com'
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  return `https://${host}/v1internal:${method}`
}

export function withClaudeOauthHeaders(headers: Record<string, string>, kind: string | undefined): Record<string, string> {
  if (kind !== 'claude') return headers
  const next = { ...headers }
  const token = next['x-api-key'] || next.Authorization?.replace(/^Bearer\s+/i, '') || ''
  delete next['x-api-key']
  if (token) next.Authorization = `Bearer ${token}`
  const beta = next['anthropic-beta']
  const parts = (beta || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.includes(CLAUDE_OAUTH_BETA)) parts.push(CLAUDE_OAUTH_BETA)
  next['anthropic-beta'] = parts.join(',')
  next['anthropic-version'] = next['anthropic-version'] || '2023-06-01'
  return next
}

export type StreamKind = 'default' | 'responses' | 'antigravity'

export function rewriteSubscriptionCall(input: {
  provider: { baseUrl?: string; subscription?: SubscriptionAuth }
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  stream: boolean
}): { url: string; headers: Record<string, string>; body: Record<string, unknown>; streamKind: StreamKind } {
  const sub = input.provider.subscription
  const base = input.provider.baseUrl || ''
  let headers = withClaudeOauthHeaders(input.headers, sub?.kind)
  let url = input.url
  let body = input.body
  let streamKind: StreamKind = 'default'

  if (sub?.kind === 'chatgpt' || isChatGptCodexBase(base)) {
    url = codexResponsesUrl(base || input.url)
    body = chatCompletionsToResponses({ ...body, stream: input.stream })
    streamKind = 'responses'
    headers = {
      ...headers,
      ...(sub?.accountId ? { 'ChatGPT-Account-ID': sub.accountId } : {}),
      'OpenAI-Beta': 'responses=v1',
      originator: 'pawn'
    }
  } else if (sub?.kind === 'antigravity' || isAntigravityBase(base)) {
    url = antigravityEndpoint(base, input.stream)
    body = chatCompletionsToAntigravity(input.body, sub?.projectId)
    streamKind = 'antigravity'
  }

  return { url, headers, body, streamKind }
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

/** Codex Responses SSE events → text, tool calls, and usage. */
export class ResponsesStream {
  private text = ''
  private calls = new Map<string, { id: string; name: string; args: string; emitted: boolean }>()

  constructor(private sink: WireSink) {}

  consume(event: Record<string, unknown>): void {
    const type = String(event.type || '')
    if (type === 'error' || type === 'response.failed') {
      const payload = type === 'response.failed' ? (event.response as { error?: unknown } | undefined)?.error : event.error
      this.sink.error(errorMessage(payload ?? event.message, 'ChatGPT stream failed'))
      return
    }
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
      this.text += event.delta
      this.sink.text(event.delta)
      return
    }
    if (type === 'response.output_text.done' && typeof event.text === 'string' && event.text.startsWith(this.text)) {
      const delta = event.text.slice(this.text.length)
      this.text = event.text
      if (delta) this.sink.text(delta)
      return
    }
    if (
      (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') &&
      typeof event.delta === 'string'
    ) {
      this.sink.reasoning(event.delta)
      return
    }
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = event.item
      if (item && typeof item === 'object' && (item as { type?: string }).type === 'function_call') {
        const row = item as { id?: string; call_id?: string; name?: string; arguments?: string }
        const key = String(row.id || row.call_id || '')
        const prev = this.calls.get(key) || { id: String(row.call_id || row.id || key), name: '', args: '', emitted: false }
        if (row.name) prev.name = row.name
        if (typeof row.arguments === 'string' && row.arguments) prev.args = row.arguments
        prev.id = String(row.call_id || prev.id || key)
        this.calls.set(key, prev)
        if (type === 'response.output_item.done') this.emitCall(key)
      }
      return
    }
    if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
      const key = String(event.item_id || '')
      const prev = this.calls.get(key) || { id: key, name: '', args: '', emitted: false }
      if (typeof event.delta === 'string') prev.args += event.delta
      if (typeof event.arguments === 'string') prev.args = event.arguments
      if (typeof event.name === 'string' && event.name) prev.name = event.name
      this.calls.set(key, prev)
      if (type === 'response.function_call_arguments.done') this.emitCall(key)
      return
    }
    if (type === 'response.completed') {
      const response = event.response
      const usage = response && typeof response === 'object' ? (response as { usage?: Record<string, unknown> }).usage : undefined
      if (usage) this.sink.usage(usageFromResponses(usage))
    }
  }

  private emitCall(key: string): void {
    const call = this.calls.get(key)
    if (!call || call.emitted || !call.name) return
    call.emitted = true
    this.sink.tool({ id: call.id || key, name: call.name, arguments: parseToolArgs(call.args) })
  }
}

function usageFromResponses(usage: Record<string, unknown>): { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } {
  const details = usage.input_tokens_details
  const cached = details && typeof details === 'object' ? (details as { cached_tokens?: unknown }).cached_tokens : undefined
  return {
    inputTokens: numberOrUndef(usage.input_tokens),
    outputTokens: numberOrUndef(usage.output_tokens),
    cacheReadTokens: numberOrUndef(cached)
  }
}

function numberOrUndef(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Cloud Code SSE payloads. Text may arrive as a growing snapshot. */
export class AntigravityStream {
  private text = ''
  private emitted = new Set<string>()

  constructor(private sink: WireSink) {}

  consume(event: Record<string, unknown>): void {
    if (event.error) {
      this.sink.error(errorMessage(event.error, 'Antigravity stream failed'))
      return
    }
    const response = (event.response && typeof event.response === 'object' ? event.response : event) as Record<string, unknown>
    const candidates = Array.isArray(response.candidates) ? response.candidates : []
    let chunk = ''
    const calls: Array<{ id: string; name: string; args: unknown }> = []
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue
      const content = (candidate as { content?: { parts?: unknown[] } }).content
      const parts = Array.isArray(content?.parts) ? content.parts : []
      for (const part of parts) {
        if (!part || typeof part !== 'object') continue
        const row = part as { text?: unknown; functionCall?: { name?: string; id?: string; args?: unknown } }
        if (typeof row.text === 'string') chunk += row.text
        if (row.functionCall?.name) {
          calls.push({
            id: row.functionCall.id || `ag_${row.functionCall.name}_${JSON.stringify(row.functionCall.args || {})}`,
            name: row.functionCall.name,
            args: row.functionCall.args
          })
        }
      }
    }
    if (chunk) {
      let delta = ''
      if (chunk.startsWith(this.text)) delta = chunk.slice(this.text.length)
      else if (!this.text.startsWith(chunk)) delta = chunk
      if (delta) {
        this.text = chunk.startsWith(this.text) ? chunk : this.text + delta
        this.sink.text(delta)
      }
    }
    for (const call of calls) {
      if (this.emitted.has(call.id)) continue
      const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args)
        ? call.args as Record<string, unknown>
        : parseToolArgs(typeof call.args === 'string' ? call.args : '')
      if (args.__parse_error === true && typeof call.args === 'string') continue
      this.emitted.add(call.id)
      this.sink.tool({ id: call.id, name: call.name, arguments: args })
    }
    const usage = (response.usageMetadata && typeof response.usageMetadata === 'object'
      ? response.usageMetadata
      : undefined) as Record<string, unknown> | undefined
    if (usage) {
      this.sink.usage({
        inputTokens: numberOrUndef(usage.promptTokenCount),
        outputTokens: numberOrUndef(usage.candidatesTokenCount),
        cacheReadTokens: numberOrUndef(usage.cachedContentTokenCount)
      })
    }
  }
}
