/**
 * DeepSeek API compatibility helpers.
 *
 * Spec: https://api-docs.deepseek.com/guides/thinking_mode/
 * - Thinking is on by default (effort high).
 * - CoT arrives as `reasoning_content` alongside `content`.
 * - When the request includes `tools`, every subsequent request must echo
 *   prior assistant `reasoning_content` or the API returns HTTP 400.
 * - `thinking: { type: "enabled" }` + `reasoning_effort` control the mode.
 */

export function isDeepSeekModel(modelId: string): boolean {
  const id = (modelId || '').toLowerCase()
  return id.includes('deepseek')
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

export type PawnReasoningEffort = 'auto' | 'low' | 'medium' | 'high' | string

/**
 * Map Pawn UI effort → DeepSeek `reasoning_effort`.
 * DeepSeek accepts: low | high | max (and maps medium-ish values to high).
 */
export function mapDeepSeekReasoningEffort(
  effort: PawnReasoningEffort | undefined | null
): 'low' | 'high' | 'max' {
  const e = (effort || 'auto').toLowerCase()
  if (e === 'low') return 'low'
  if (e === 'max' || e === 'xhigh') return 'max'
  // auto / medium / high → high (DeepSeek default)
  return 'high'
}

export type DeepSeekThinkingMode = 'enabled' | 'disabled'

/**
 * Build OpenAI-compat body extras for DeepSeek thinking mode.
 * Always enable thinking for agent turns (tools) unless explicitly disabled later.
 */
export function deepSeekChatBodyExtras(opts: {
  modelId: string
  reasoningEffort?: PawnReasoningEffort | null
  /** When false, send thinking disabled (rare). Default true for DeepSeek agent. */
  thinkingEnabled?: boolean
}): Record<string, unknown> {
  if (!isDeepSeekModel(opts.modelId)) return {}

  const enabled = opts.thinkingEnabled !== false
  const extras: Record<string, unknown> = {
    // Required for reliable thinking+tools on DeepSeek V4.
    thinking: { type: enabled ? 'enabled' : 'disabled' }
  }
  if (enabled) {
    extras.reasoning_effort = mapDeepSeekReasoningEffort(opts.reasoningEffort)
  }
  return extras
}

/**
 * Whether this assistant message should carry reasoning_content on the wire
 * for a DeepSeek (or similar) request that includes tools.
 * Empty string still counts — the field must be present for tool-call turns.
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
