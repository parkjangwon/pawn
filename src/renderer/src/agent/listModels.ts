/**
 * Live model catalog sync via OpenAI-compatible GET {baseUrl}/models.
 *
 * Used so presets are only a bootstrap seed — the user can refresh against
 * whatever the provider currently offers (OpenCode Go, Command Code, DeepSeek,
 * OpenAI, Ollama, …). Non-chat surfaces (embeddings, TTS, ASR) are filtered out.
 */

import { uid } from '../utils/uid'
import { guessPricing, guessSupportsVision } from '../types/provider'
import type { ApiFormat, ModelEntry, ModelTier, Provider } from '../types/provider'

export interface RemoteModel {
  id: string
  label: string
  contextWindow?: number
  ownedBy?: string
}

export interface ListModelsResult {
  models: RemoteModel[]
  /** Raw count before non-chat filtering. */
  rawCount: number
}

export interface MergeModelsResult {
  models: ModelEntry[]
  added: number
  updated: number
  remoteCount: number
}

/** Substrings that mark non-chat / non-agent model ids. */
const NON_CHAT_MARKERS = [
  'embed',
  'embedding',
  'text-embedding',
  'tts',
  'asr',
  'whisper',
  'speech',
  'voiceclone',
  'voicedesign',
  'dall-e',
  'dalle',
  'image-1',
  'moderation',
  'rerank',
  'transcri',
  'realtime',
  'audio-preview'
]

export function isLikelyChatModel(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  if (!id) return false
  return !NON_CHAT_MARKERS.some((m) => id.includes(m))
}

/** Humanize `deepseek/deepseek-v4-flash` → `Deepseek V4 Flash`. */
export function humanizeModelId(modelId: string): string {
  const leaf = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  return leaf
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bV(\d)/gi, 'V$1')
    .trim()
}

export function modelsListUrl(baseUrl: string): string {
  const b = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!b) throw new Error('Provider base URL is empty')
  if (b.endsWith('/models')) return b
  return `${b}/models`
}

/**
 * Auth headers for GET /models.
 * - OpenAI-compat: Authorization Bearer
 * - Anthropic-compat: x-api-key
 * - Xiaomi MiMo curl docs also accept `api-key`; OpenAI SDK uses Bearer — send both.
 */
export function authHeadersForProvider(provider: Pick<Provider, 'apiFormat' | 'baseUrl' | 'apiKey'>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = (provider.apiKey || '').trim()
  if (!token) return headers

  if (provider.apiFormat === 'claude') {
    headers['x-api-key'] = token
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.Authorization = `Bearer ${token}`
  }

  if (isXiaomiMimoHost(provider.baseUrl)) {
    headers['api-key'] = token
    // Some MiMo samples use only api-key; keep Bearer when already set.
    if (!headers.Authorization) headers.Authorization = `Bearer ${token}`
  }

  return headers
}

export function isXiaomiMimoHost(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false
  try {
    const host = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).hostname.toLowerCase()
    return host === 'api.xiaomimimo.com'
      || host.endsWith('.xiaomimimo.com')
      || host.includes('xiaomimimo.com')
  } catch {
    return /xiaomimimo\.com/i.test(baseUrl)
  }
}

function parseModelsPayload(json: unknown): RemoteModel[] {
  const out: RemoteModel[] = []
  const data = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data)
      ? (json as { data: unknown[] }).data
      : json && typeof json === 'object' && Array.isArray((json as { models?: unknown }).models)
        ? (json as { models: unknown[] }).models
        : []

  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = String(row.id || row.model || row.name || '').trim()
    if (!id) continue
    const labelRaw = row.name ?? row.display_name ?? row.displayName
    const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : humanizeModelId(id)
    const ctx =
      num(row.context_length)
      ?? num(row.context_window)
      ?? num(row.contextWindow)
      ?? num(row.max_model_len)
      ?? (row.meta && typeof row.meta === 'object'
        ? num((row.meta as Record<string, unknown>).context_length)
        : undefined)
    const ownedBy = typeof row.owned_by === 'string' ? row.owned_by : undefined
    out.push({ id, label, contextWindow: ctx, ownedBy })
  }
  return out
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v)
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
    const n = Number(v)
    return n > 0 ? Math.floor(n) : undefined
  }
  return undefined
}

async function doFetch(
  url: string,
  headers: Record<string, string>,
  isBrowser: boolean,
  signal?: AbortSignal
): Promise<Response> {
  const effectiveSignal = signal || AbortSignal.timeout(15_000)
  if (isBrowser) {
    // Reuse the same proxy path chat completions use.
    return fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method: 'GET', headers }),
      signal: effectiveSignal
    })
  }
  return fetch(url, { method: 'GET', headers, signal: effectiveSignal })
}

/**
 * GET {baseUrl}/models and return chat-like models.
 * Throws with a readable message on HTTP / network failure.
 */
export async function fetchProviderModels(
  provider: Pick<Provider, 'apiFormat' | 'baseUrl' | 'apiKey' | 'name'>,
  opts?: { isBrowser?: boolean; signal?: AbortSignal }
): Promise<ListModelsResult> {
  const url = modelsListUrl(provider.baseUrl)
  const headers = authHeadersForProvider(provider)
  const isBrowser = opts?.isBrowser ?? (typeof window !== 'undefined' && window.api?.platform === 'browser')

  let response: Response
  try {
    response = await doFetch(url, headers, isBrowser, opts?.signal)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach models endpoint: ${msg}`)
  }

  const text = await response.text()
  if (!response.ok) {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ')
    throw new Error(`Models list failed (${response.status}): ${snippet || response.statusText}`)
  }

  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('Models list returned non-JSON')
  }

  const parsed = parseModelsPayload(json)
  const models = parsed.filter((m) => isLikelyChatModel(m.id))
  return { models, rawCount: parsed.length }
}

function tierFor(modelId: string): ModelTier {
  return guessPricing(modelId)?.tier || 'mid'
}

/**
 * Merge a remote catalog into the local model list for one provider.
 * - Adds missing models (enabled by default)
 * - Refreshes label / contextWindow / missing pricing on existing rows
 * - Never removes models the user already has (API may temporarily omit some)
 * - Never flips enabled or overwrites user-set pricing
 */
export function mergeRemoteModels(
  existing: ModelEntry[],
  providerId: string,
  remote: RemoteModel[]
): MergeModelsResult {
  const others = existing.filter((m) => m.providerId !== providerId)
  const mine = existing.filter((m) => m.providerId === providerId)
  const byId = new Map(mine.map((m) => [m.modelId, m]))

  let added = 0
  let updated = 0
  const nextMine: ModelEntry[] = []

  for (const r of remote) {
    const prev = byId.get(r.id)
    if (prev) {
      byId.delete(r.id)
      const guess = !prev.pricing ? guessPricing(r.id) : null
      const patch: ModelEntry = {
        ...prev,
        // Prefer live display name when ours still looks auto-generated.
        label:
          r.label
          && (prev.label === prev.modelId || prev.label === humanizeModelId(prev.modelId))
            ? r.label
            : prev.label || r.label,
        contextWindow: r.contextWindow || prev.contextWindow || guess?.contextWindow,
        pricing: prev.pricing || (guess
          ? { input: guess.input, output: guess.output, cacheRead: guess.cacheRead, cacheWrite: guess.cacheWrite }
          : undefined)
      }
      if (
        patch.label !== prev.label
        || patch.contextWindow !== prev.contextWindow
        || patch.pricing !== prev.pricing
      ) {
        updated += 1
      }
      nextMine.push(patch)
    } else {
      const guess = guessPricing(r.id)
      nextMine.push({
        id: uid(),
        providerId,
        modelId: r.id,
        label: r.label || humanizeModelId(r.id),
        tier: tierFor(r.id),
        enabled: true,
        pricing: guess
          ? { input: guess.input, output: guess.output, cacheRead: guess.cacheRead, cacheWrite: guess.cacheWrite }
          : undefined,
        contextWindow: r.contextWindow || guess?.contextWindow,
        supportsVision: guessSupportsVision(r.id)
      })
      added += 1
    }
  }

  // Keep local-only models (user-added or temporarily missing from API).
  for (const leftover of byId.values()) nextMine.push(leftover)

  // Stable sort: remote order first, then leftovers.
  const remoteOrder = new Map(remote.map((r, i) => [r.id, i]))
  nextMine.sort((a, b) => {
    const ai = remoteOrder.has(a.modelId) ? remoteOrder.get(a.modelId)! : 10_000
    const bi = remoteOrder.has(b.modelId) ? remoteOrder.get(b.modelId)! : 10_000
    if (ai !== bi) return ai - bi
    return a.modelId.localeCompare(b.modelId)
  })

  return {
    models: [...others, ...nextMine],
    added,
    updated,
    remoteCount: remote.length
  }
}

/** @deprecated type alias for callers that only need format */
export type ListModelsApiFormat = ApiFormat
