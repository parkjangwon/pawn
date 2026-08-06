/**
 * DeepSeek API first-class compatibility (V4 Flash / Pro).
 *
 * Official references (2026-08):
 * - https://api-docs.deepseek.com/quick_start/pricing/
 * - https://api-docs.deepseek.com/guides/thinking_mode/
 * - https://api-docs.deepseek.com/guides/kv_cache/
 * - https://api-docs.deepseek.com/api/create-chat-completion/
 *
 * Cost model (USD / 1M tokens, regular):
 *   deepseek-v4-flash: miss $0.14 · hit $0.0028 · out $0.28
 *   deepseek-v4-pro:   miss $0.435 · hit $0.003625 · out $0.87
 * Disk context cache is automatic (stable prefixes → huge savings).
 * Thinking CoT is billed as output; keep effort adaptive.
 */

export type Complexity = 'simple' | 'medium' | 'complex'
export type PawnReasoningEffort = 'auto' | 'low' | 'medium' | 'high' | 'max' | string
export type DeepSeekEffort = 'low' | 'high' | 'max'

export function isDeepSeekModel(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  return id.includes('deepseek')
}

/** Official api.deepseek.com (OpenAI or Anthropic path). */
export function isDeepSeekOfficialHost(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false
  try {
    const host = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).hostname.toLowerCase()
    return host === 'api.deepseek.com' || host.endsWith('.deepseek.com')
  } catch {
    return /api\.deepseek\.com/i.test(baseUrl)
  }
}

export function isDeepSeekV4Pro(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  return id.includes('v4-pro') || id.includes('deepseek-pro')
}

export function isDeepSeekV4Flash(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  if (isDeepSeekV4Pro(id)) return false
  return (
    id.includes('v4-flash') ||
    id.includes('deepseek-chat') ||
    id.includes('deepseek-reasoner') ||
    // bare deepseek-v4 without pro
    /deepseek-v4($|[^a-z])/.test(id)
  )
}

/** OpenAI-compat hosts that need the same reasoning_content echo rules. */
export function needsReasoningContentEcho(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  if (isDeepSeekModel(id)) return true
  return (
    id.includes('reasoner') ||
    id.includes('qwq') ||
    id.includes('qwen3-thinking') ||
    /\/thinking($|[-_])/.test(id)
  )
}

/**
 * Map UI effort → DeepSeek wire `reasoning_effort`.
 * Flash: low | high | max. Pro (early Aug 2026): low→high, xhigh→max.
 */
export function mapDeepSeekReasoningEffort(
  effort: PawnReasoningEffort | undefined | null,
  modelId?: string
): DeepSeekEffort {
  const e = (effort || 'auto').toLowerCase()
  const pro = modelId ? isDeepSeekV4Pro(modelId) : false
  if (e === 'low') return pro ? 'high' : 'low'
  if (e === 'max' || e === 'xhigh') return 'max'
  // auto / medium / high → high (DeepSeek default)
  return 'high'
}

export interface DeepSeekAgentPolicy {
  thinkingEnabled: boolean
  reasoningEffort: DeepSeekEffort
  /** Completion budget (reasoning tokens count against this in thinking mode). */
  maxTokens: number
}

/**
 * Cost/performance policy for agent turns.
 * - simple + auto → non-thinking (fast, cheap; tools still work)
 * - medium + auto → think with low (Flash) / high (Pro)
 * - complex + auto → think high (Flash) / max (Pro)
 * Explicit UI effort always enables thinking at the mapped level.
 */
export function resolveDeepSeekAgentPolicy(opts: {
  modelId: string
  reasoningEffort?: PawnReasoningEffort | null
  complexity?: Complexity | null
}): DeepSeekAgentPolicy {
  const effort = (opts.reasoningEffort || 'auto').toLowerCase()
  const complexity = opts.complexity || 'medium'
  const pro = isDeepSeekV4Pro(opts.modelId)

  if (effort === 'low') {
    return {
      thinkingEnabled: true,
      reasoningEffort: mapDeepSeekReasoningEffort('low', opts.modelId),
      maxTokens: 16_384
    }
  }
  if (effort === 'medium' || effort === 'high') {
    return { thinkingEnabled: true, reasoningEffort: 'high', maxTokens: 32_768 }
  }
  if (effort === 'max' || effort === 'xhigh') {
    return { thinkingEnabled: true, reasoningEffort: 'max', maxTokens: 65_536 }
  }

  // auto
  if (complexity === 'simple') {
    return { thinkingEnabled: false, reasoningEffort: 'high', maxTokens: 8_192 }
  }
  if (complexity === 'complex') {
    return {
      thinkingEnabled: true,
      reasoningEffort: pro ? 'max' : 'high',
      maxTokens: pro ? 65_536 : 32_768
    }
  }
  // medium: Flash prefers low effort (cheaper CoT); Pro maps low→high
  return {
    thinkingEnabled: true,
    reasoningEffort: mapDeepSeekReasoningEffort(pro ? 'high' : 'low', opts.modelId),
    maxTokens: 24_576
  }
}

/**
 * OpenAI Chat Completions body extras for DeepSeek thinking mode.
 * Spec: thinking.type + reasoning_effort; default thinking is enabled/high.
 */
export function deepSeekChatBodyExtras(opts: {
  modelId: string
  reasoningEffort?: PawnReasoningEffort | null
  complexity?: Complexity | null
  /** Override policy thinking flag. */
  thinkingEnabled?: boolean
}): Record<string, unknown> {
  if (!isDeepSeekModel(opts.modelId)) return {}

  const policy = resolveDeepSeekAgentPolicy({
    modelId: opts.modelId,
    reasoningEffort: opts.reasoningEffort,
    complexity: opts.complexity
  })
  const enabled = opts.thinkingEnabled !== undefined ? opts.thinkingEnabled : policy.thinkingEnabled

  const extras: Record<string, unknown> = {
    thinking: { type: enabled ? 'enabled' : 'disabled' }
  }
  if (enabled) {
    extras.reasoning_effort =
      opts.thinkingEnabled === true && opts.reasoningEffort && opts.reasoningEffort !== 'auto'
        ? mapDeepSeekReasoningEffort(opts.reasoningEffort, opts.modelId)
        : policy.reasoningEffort
  }
  return extras
}

export function deepSeekMaxTokens(opts: {
  modelId: string
  reasoningEffort?: PawnReasoningEffort | null
  complexity?: Complexity | null
}): number {
  if (!isDeepSeekModel(opts.modelId)) return 16_384
  return resolveDeepSeekAgentPolicy(opts).maxTokens
}

/**
 * Stable user_id for official DeepSeek (KV-cache isolation + scheduling).
 * Allowed: [a-zA-Z0-9_-], max 512. Prefer project scope so multi-turn cache hits.
 */
export function deepSeekUserId(projectId?: string | null, sessionId?: string | null): string {
  const raw = (projectId && projectId !== '__general__' ? projectId : sessionId) || 'default'
  const cleaned = String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 480)
  return `pawn_${cleaned || 'default'}`
}

/**
 * Whether this assistant message should carry reasoning_content on the wire.
 * Empty string still counts for tool-call turns (API 400 if omitted with tools).
 */
export function shouldEchoReasoningOnWire(
  modelId: string,
  reasoningContent: string | undefined | null,
  hasToolCalls = false
): boolean {
  if (!needsReasoningContentEcho(modelId)) return false
  if (hasToolCalls) return true
  return reasoningContent != null
}

/**
 * Map OpenAI-compat or DeepSeek-native usage into Pawn CallUsage.
 * DeepSeek: prompt_cache_hit_tokens / prompt_cache_miss_tokens (disk cache).
 * OpenAI-style: prompt_tokens_details.cached_tokens.
 *
 * Cost model expects:
 *   inputTokens      = uncached / miss prompt tokens (full input rate)
 *   cacheReadTokens  = hit tokens (cache-hit rate)
 *   cacheWriteTokens = Anthropic-style write (DeepSeek usually 0)
 */
export function parseCompatUsage(raw: Record<string, unknown> | null | undefined): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
} {
  const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
  if (!raw || typeof raw !== 'object') return empty

  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const prompt = n(raw.prompt_tokens)
  const completion = n(raw.completion_tokens)
  const details = (raw.prompt_tokens_details || {}) as Record<string, unknown>
  const completionDetails = (raw.completion_tokens_details || {}) as Record<string, unknown>

  const hitNative = raw.prompt_cache_hit_tokens
  const missNative = raw.prompt_cache_miss_tokens
  const hasDeepSeekCache = hitNative != null || missNative != null

  let cacheRead = 0
  let input = 0
  if (hasDeepSeekCache) {
    cacheRead = n(hitNative)
    input = missNative != null ? n(missNative) : Math.max(0, prompt - cacheRead)
  } else {
    cacheRead = n(details.cached_tokens)
    input = Math.max(0, prompt - cacheRead)
  }

  return {
    inputTokens: input,
    outputTokens: completion,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: n(raw.cache_creation_input_tokens) || n(details.cache_write_tokens),
    reasoningTokens: n(completionDetails.reasoning_tokens)
  }
}
