/**
 * Second opinion for a stuck agent: one non-streaming call to the strongest
 * available model that is NOT the one currently driving the turn (preferably
 * from another provider), given a compact digest of the goal and the recent
 * tool history. Any failure returns null — recovery then continues without it.
 */

import { useProviderStore } from '../stores/provider'
import { useUsageStore } from '../stores/usage'
import type { ModelEntry, Provider } from '../types/provider'
import { parseSummaryResponse } from './compaction'
import { fetchWithRetry } from './llm'
import { isProviderAvailable } from './router'
import { SECOND_OPINION_PROMPT } from './stuckRecovery'
import { prepareSideCall } from './subscriptionSession'

const TIER_RANK: Record<string, number> = { low: 0, mid: 1, high: 2 }
const TIMEOUT_MS = 60_000

export function pickSecondOpinionModel(currentKey: string): { provider: Provider; model: ModelEntry } | null {
  const { providers, models } = useProviderStore.getState()
  const byId = new Map(providers.filter((p) => p.enabled && p.apiKey?.trim()).map((p) => [p.id, p]))
  const currentProvider = currentKey.slice(0, currentKey.indexOf(':'))
  const pool: Array<{ provider: Provider; model: ModelEntry }> = []
  for (const model of models) {
    if (!model.enabled || model.supportsTools === false) continue
    if (`${model.providerId}:${model.modelId}` === currentKey) continue
    const provider = byId.get(model.providerId)
    if (!provider || !isProviderAvailable(provider.id)) continue
    pool.push({ provider, model })
  }
  if (!pool.length) return null
  pool.sort((a, b) => {
    const other = Number(b.provider.id !== currentProvider) - Number(a.provider.id !== currentProvider)
    if (other) return other
    return (TIER_RANK[b.model.tier] ?? 1) - (TIER_RANK[a.model.tier] ?? 1)
  })
  return pool[0]
}

export async function requestSecondOpinion(
  digest: string,
  opts: { currentKey: string; sessionId: string; signal?: AbortSignal }
): Promise<{ text: string; model: string } | null> {
  const target = pickSecondOpinionModel(opts.currentKey)
  if (!target) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal
  const body =
    target.provider.apiFormat === 'claude'
      ? {
          model: target.model.modelId,
          max_tokens: 900,
          system: SECOND_OPINION_PROMPT,
          messages: [{ role: 'user', content: digest }]
        }
      : {
          model: target.model.modelId,
          max_tokens: 900,
          stream: false,
          messages: [
            { role: 'system', content: SECOND_OPINION_PROMPT },
            { role: 'user', content: digest }
          ]
        }
  try {
    const call = await prepareSideCall(target.provider, body)
    const res = await fetchWithRetry(
      call.url,
      call.headers,
      call.body,
      window.api?.platform === 'browser',
      signal
    )
    const { text, usage } = parseSummaryResponse(await res.json())
    try {
      useUsageStore.getState().record(opts.sessionId, target.model, usage)
    } catch {
      /* best effort */
    }
    return text.trim().length >= 20 ? { text: text.trim(), model: target.model.label || target.model.modelId } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
