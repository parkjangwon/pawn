/**
 * DeepSeek API first-class compatibility (V4 Flash / Pro).
 *
 * Official docs (authoritative):
 * - https://api-docs.deepseek.com/
 * - https://api-docs.deepseek.com/quick_start/pricing/
 * - https://api-docs.deepseek.com/guides/thinking_mode/
 * - https://api-docs.deepseek.com/guides/kv_cache/
 * - https://api-docs.deepseek.com/guides/tool_calls/
 * - https://api-docs.deepseek.com/api/create-chat-completion/
 * - https://api-docs.deepseek.com/quick_start/rate_limit
 * - https://api-docs.deepseek.com/guides/anthropic_api
 *
 * Pricing (USD / 1M, regular — subject to official notice of increases):
 *   deepseek-v4-flash: miss $0.14 · hit $0.0028 · out $0.28 · concurrency 2500
 *   deepseek-v4-pro:   miss $0.435 · hit $0.003625 · out $0.87 · concurrency 500
 * Context 1M · max output 384K · thinking default on (effort high).
 * Disk cache is automatic; stable message prefixes matter more than any flag.
 */

export type Complexity = 'simple' | 'medium' | 'complex'
export type PawnReasoningEffort = 'auto' | 'low' | 'medium' | 'high' | 'max' | string
export type DeepSeekEffort = 'low' | 'high' | 'max'

/** Official model ids (OpenAI Chat Completions). */
export const DEEPSEEK_MODELS = {
  flash: 'deepseek-v4-flash',
  pro: 'deepseek-v4-pro'
} as const

export const DEEPSEEK_OPENAI_BASE = 'https://api.deepseek.com'
export const DEEPSEEK_ANTHROPIC_BASE = 'https://api.deepseek.com/anthropic'

export function isDeepSeekModel(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  // Local ollama deepseek-r1 is not the official API surface.
  if (id === 'deepseek-r1' || id.startsWith('deepseek-r1:')) return false
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

export function isDeepSeekAnthropicBase(baseUrl: string | undefined | null): boolean {
  if (!baseUrl || !isDeepSeekOfficialHost(baseUrl)) return false
  return /\/anthropic\/?$/i.test(baseUrl.replace(/\/$/, '')) || baseUrl.includes('/anthropic')
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
    /deepseek-v4($|[^a-z])/.test(id)
  )
}

/**
 * Normalize OpenAI-compatible chat URL for DeepSeek.
 * Docs: base_url = https://api.deepseek.com  →  POST .../chat/completions
 * Users often append /v1 — both work; keep /v1 if present.
 */
export function deepSeekChatCompletionsUrl(baseUrl: string): string {
  let b = (baseUrl || DEEPSEEK_OPENAI_BASE).trim().replace(/\/+$/, '')
  if (!b) b = DEEPSEEK_OPENAI_BASE
  if (b.endsWith('/chat/completions')) return b
  // Anthropic path uses /messages, not chat completions
  if (isDeepSeekAnthropicBase(b)) {
    return b.endsWith('/messages') ? b : `${b}/messages`
  }
  return `${b}/chat/completions`
}

/** OpenAI-compat hosts that need the same reasoning_content echo rules. */
export function needsReasoningContentEcho(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  if (isDeepSeekModel(id)) return true
  // Xiaomi MiMo V2.5+: multi-turn tool calls in thinking mode require reasoning_content
  // to be echoed back (mimo.mi.com first-api-call docs).
  if (id.includes('mimo-v2') || id.includes('mimo/v2') || /(^|\/)mimo-v2/.test(id)) return true
  return (
    id.includes('reasoner') ||
    id.includes('qwq') ||
    id.includes('qwen3-thinking') ||
    /\/thinking($|[-_])/.test(id)
  )
}

/**
 * Map UI effort → DeepSeek wire `reasoning_effort`.
 * Spec table: low | high | max; medium→high; Flash xhigh→high; Pro low→high, xhigh→max.
 */
export function mapDeepSeekReasoningEffort(
  effort: PawnReasoningEffort | undefined | null,
  modelId?: string
): DeepSeekEffort {
  const e = (effort || 'auto').toLowerCase()
  const pro = modelId ? isDeepSeekV4Pro(modelId) : false
  if (e === 'low') return pro ? 'high' : 'low'
  if (e === 'max') return 'max'
  if (e === 'xhigh') return pro ? 'max' : 'high'
  // auto / medium / high → high (DeepSeek default)
  return 'high'
}

const mapEffort = mapDeepSeekReasoningEffort

export interface DeepSeekAgentPolicy {
  thinkingEnabled: boolean
  reasoningEffort: DeepSeekEffort
  /** Completion budget; reasoning tokens count against this (thinking mode). Max API: 384K. */
  maxTokens: number
}

/**
 * Cost/performance policy for agent turns (BYOK — tokens are cash).
 * - simple + auto → non-thinking (tools still work; docs non-thinking tool mode)
 * - medium + auto → think low (Flash) / high (Pro maps low→high)
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
      reasoningEffort: mapEffort('low', opts.modelId),
      maxTokens: 16_384
    }
  }
  if (effort === 'medium' || effort === 'high') {
    return { thinkingEnabled: true, reasoningEffort: 'high', maxTokens: 32_768 }
  }
  if (effort === 'max' || effort === 'xhigh') {
    return {
      thinkingEnabled: true,
      reasoningEffort: mapEffort(effort, opts.modelId),
      maxTokens: 65_536
    }
  }

  // auto
  if (complexity === 'simple') {
    return { thinkingEnabled: false, reasoningEffort: 'high', maxTokens: 8_192 }
  }
  if (complexity === 'complex') {
    return {
      thinkingEnabled: true,
      reasoningEffort: pro ? 'max' : 'high',
      // Headroom for long tool+CoT loops (API max 384K; keep practical)
      maxTokens: pro ? 98_304 : 49_152
    }
  }
  return {
    thinkingEnabled: true,
    reasoningEffort: mapEffort(pro ? 'high' : 'low', opts.modelId),
    maxTokens: 24_576
  }
}

/** OpenAI Chat Completions body extras: thinking + reasoning_effort. */
export function deepSeekChatBodyExtras(opts: {
  modelId: string
  reasoningEffort?: PawnReasoningEffort | null
  complexity?: Complexity | null
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
        ? mapEffort(opts.reasoningEffort, opts.modelId)
        : policy.reasoningEffort
    // DeepSeek official docs & harness: In thinking mode, temperature must be 1.0 (or top_p=1.0)
    // to allow natural chain-of-thought exploration and avoid thinking collapse.
    extras.temperature = 1.0
  } else {
    // Non-thinking coding / agent mode: 0.0 for deterministic tool & code generation
    extras.temperature = 0.0
  }
  return extras
}

/**
 * Anthropic-format body extras for https://api.deepseek.com/anthropic
 * Docs: thinking supported (budget_tokens ignored); output_config.effort; metadata.user_id
 */
export function deepSeekAnthropicBodyExtras(opts: {
  modelId: string
  reasoningEffort?: PawnReasoningEffort | null
  complexity?: Complexity | null
  userId?: string
}): Record<string, unknown> {
  if (!isDeepSeekModel(opts.modelId)) return {}
  const policy = resolveDeepSeekAgentPolicy(opts)
  const extras: Record<string, unknown> = {}
  if (policy.thinkingEnabled) {
    // budget_tokens is ignored by DeepSeek; type-only is enough.
    extras.thinking = { type: 'enabled' }
    extras.output_config = { effort: policy.reasoningEffort }
  } else {
    // Anthropic path: reasoning.effort "none" disables thinking
    extras.thinking = { type: 'disabled' }
  }
  if (opts.userId) {
    extras.metadata = { user_id: opts.userId }
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
 * Stable user_id for official DeepSeek (content safety + KV isolation + scheduling).
 * Spec: [a-zA-Z0-9_-]+, max 512. No PII.
 * Prefer project scope so multi-turn disk/KV cache hits stay high.
 */
export function deepSeekUserId(projectId?: string | null, sessionId?: string | null): string {
  const raw = (projectId && projectId !== '__general__' ? projectId : sessionId) || 'default'
  const cleaned = String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 480)
  return `pawn_${cleaned || 'default'}`
}

/**
 * When the request includes `tools`, every assistant message that used tools
 * must carry reasoning_content (even ""). Spec: tool calls section of thinking_mode.
 */
export function shouldEchoReasoningOnWire(
  modelId: string,
  reasoningContent: string | undefined | null,
  hasToolCalls = false
): boolean {
  if (!needsReasoningContentEcho(modelId)) return false
  if (hasToolCalls) return true
  return reasoningContent != null && reasoningContent !== ''
}

/**
 * Map OpenAI-compat or DeepSeek-native usage into Pawn CallUsage.
 * DeepSeek: prompt_cache_hit_tokens / prompt_cache_miss_tokens (disk cache).
 * Cost: miss @ input rate, hit @ cacheRead rate; no separate write fee.
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
    // DeepSeek has no cache-write fee; keep 0 so cost model doesn't double-count.
    cacheWriteTokens: hasDeepSeekCache ? 0 : n(raw.cache_creation_input_tokens) || n(details.cache_write_tokens),
    reasoningTokens: n(completionDetails.reasoning_tokens)
  }
}

/** Detect rate-limit / capacity errors worth retrying (HTTP 429, insufficient_system_resource). */
export function isDeepSeekRetryableError(status: number, bodyText: string): boolean {
  if (status === 429 || status >= 500) return true
  const t = (bodyText || '').toLowerCase()
  return (
    t.includes('insufficient_system_resource') ||
    t.includes('rate limit') ||
    t.includes('too many requests')
  )
}

/**
 * DeepSeek Beta FIM (Fill-in-the-Middle) completions URL.
 * Official doc: POST https://api.deepseek.com/beta/completions
 */
export function deepSeekFimUrl(baseUrl?: string): string {
  let b = (baseUrl || DEEPSEEK_OPENAI_BASE).trim().replace(/\/+$/, '')
  if (!b) b = DEEPSEEK_OPENAI_BASE
  if (b.endsWith('/beta/completions')) return b
  if (b.endsWith('/v1') || b.endsWith('/beta')) b = b.replace(/\/(v1|beta)$/, '')
  return `${b}/beta/completions`
}

export interface DeepSeekFimOpts {
  model?: string
  prompt: string
  suffix?: string
  maxTokens?: number
  temperature?: number
  stop?: string[]
}

/**
 * Build request body for DeepSeek FIM code completion.
 */
export function buildDeepSeekFimBody(opts: DeepSeekFimOpts): Record<string, unknown> {
  return {
    model: opts.model || 'deepseek-chat',
    prompt: opts.prompt,
    suffix: opts.suffix || '',
    max_tokens: Math.min(Math.max(Number(opts.maxTokens) || 4096, 1), 8192),
    temperature: opts.temperature ?? 0.0,
    stop: opts.stop || []
  }
}

/**
 * System prompt guidelines for DeepSeek coding agents per DeepSeek Harness recommendations:
 * 1. Direct tool invocations with valid JSON parameters.
 * 2. Unambiguous file edits and code generation without meta-commentary inside tool arguments.
 * 3. Stable prefix formatting to maximize KV cache hit rate.
 */
export function deepSeekAgentGuidelines(): string {
  return [
    '# DeepSeek Agent Execution Guidelines',
    '- Prioritize direct tool calls over explanatory prose when performing code edits.',
    '- Maintain strict JSON parameter validity when passing file paths and edit chunks.',
    '- Use step-by-step reasoning in thinking mode before finalizing code modifications.'
  ].join('\n')
}


