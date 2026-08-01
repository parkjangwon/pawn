// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProviderStore } from '../../stores/provider'
import { route, refreshMeasuredPricing } from '../router'

const getUsageSummaryMock = vi.fn()

beforeEach(() => {
  ;(window as any).api = { db: { getUsageSummary: getUsageSummaryMock } }
  getUsageSummaryMock.mockReset()
  useProviderStore.setState({
    providers: [{ id: 'p1', name: 'P', apiFormat: 'openai', baseUrl: 'https://x', enabled: true }],
    models: [
      { id: 'p1:m-a', providerId: 'p1', modelId: 'gpt-4o', label: 'A', tier: 'low', enabled: true, pricing: { input: 10, output: 20, cacheRead: 1, cacheWrite: 5 } },
      { id: 'p1:m-b', providerId: 'p1', modelId: 'gpt-4o-mini', label: 'B', tier: 'low', enabled: true, pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 } }
    ],
    routingMode: 'auto',
    activeModelId: null
  })
})

describe('measured pricing', () => {
  const entries = [{ role: 'user' as const, content: 'x'.repeat(10_000) }]

  it('prefers the statically cheapest model before any usage data exists', async () => {
    getUsageSummaryMock.mockResolvedValue([])
    await refreshMeasuredPricing(0)
    const d = route({ sessionId: 's', entries, complexity: 'simple' })
    expect(d?.model.modelId).toBe('gpt-4o-mini')
  })

  it('flips the pick when measured costs disagree with the static snapshot', async () => {
    getUsageSummaryMock.mockResolvedValue([
      { modelId: 'gpt-4o', providerId: 'p1', calls: 1, inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.026 },
      { modelId: 'gpt-4o-mini', providerId: 'p1', calls: 1, inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.03 }
    ])
    await refreshMeasuredPricing(0)
    // Scales are computed against the static KNOWN_PRICING snapshot
    // (gpt-4o input 2.5, gpt-4o-mini input 0.15): gpt-4o ~0.104x (effective
    // input ~1.04) vs gpt-4o-mini 2x (effective input 2). Static cheapest is
    // gpt-4o-mini (input 1); measured flips to gpt-4o.
    const d = route({ sessionId: 's', entries, complexity: 'simple' })
    expect(d?.model.modelId).toBe('gpt-4o')
  })

  it('rejects outlier scales', async () => {
    getUsageSummaryMock.mockResolvedValue([
      { modelId: 'gpt-4o-mini', providerId: 'p1', calls: 1, inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 50.0 }
    ])
    await refreshMeasuredPricing(0)
    // 500x scale is outside the 0.1..10 band, so static pricing stays in force
    // and the cheapest model is still gpt-4o-mini.
    const d = route({ sessionId: 's', entries, complexity: 'simple' })
    expect(d?.model.modelId).toBe('gpt-4o-mini')
  })
})
