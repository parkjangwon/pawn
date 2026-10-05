import { callLLM } from '../llm'
import { route, routeKey, type RouteDecision } from '../router'
import type { TranscriptEntry } from '../transcript'
import { useProviderStore } from '../../stores/provider'

export interface ModCompleteOpts {
  model?: string
  system?: string
  prompt: string
  maxTokens?: number
  timeoutMs?: number
}

function pinnedDecision(modelId: string): RouteDecision | null {
  const state = useProviderStore.getState()
  const model = state.models.find(
    (m) => m.enabled !== false && (m.modelId === modelId || m.id === modelId)
  )
  if (!model) return null
  const provider = state.providers.find((p) => p.id === model.providerId && p.enabled !== false)
  if (!provider) return null
  return {
    provider,
    model,
    key: routeKey(model),
    tier: model.tier,
    reason: 'mod model.complete'
  }
}

/** One quiet completion on the user's model. Does not write into the chat transcript. */
export async function modModelComplete(
  opts: ModCompleteOpts
): Promise<{ isAnswered: boolean; text?: string; reason?: string }> {
  const prompt = String(opts.prompt || '').trim()
  if (!prompt) return { isAnswered: false, reason: 'prompt is empty' }
  const entries: TranscriptEntry[] = [{ role: 'user', content: prompt }]
  const requested = typeof opts.model === 'string' ? opts.model.trim() : ''
  const decision = requested
    ? pinnedDecision(requested)
    : route({ sessionId: 'mod:complete', entries, complexity: 'simple', newTurn: true })
  if (!decision) {
    return {
      isAnswered: false,
      reason: requested ? `Model is not configured: ${requested}` : 'No model is configured'
    }
  }
  const timeoutMs = Math.min(180_000, Math.max(1_000, Math.floor(Number(opts.timeoutMs) || 60_000)))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const result = await callLLM({
      decision,
      entries,
      systemLayers: opts.system ? [String(opts.system)] : [],
      projectPreamble: '',
      sessionId: 'mod:complete',
      projectId: 'mod:complete',
      assistantMsgId: 'mod-complete',
      signal: controller.signal,
      noTools: true,
      quiet: true,
      complexity: 'simple',
      maxTokens: opts.maxTokens
    })
    const text = result.text.trim()
    if (!text) return { isAnswered: false, reason: 'Empty completion' }
    return { isAnswered: true, text }
  } catch (err) {
    return { isAnswered: false, reason: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}
