// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUsageStore, computeCost, computeUncachedCost, formatCost, formatTokens, diagnosticsFor } from '../usage'
import type { ModelEntry } from '../../types/provider'

const model = (pricing?: ModelEntry['pricing']): ModelEntry => ({
  id: 'p:m', providerId: 'p', modelId: 'm', label: 'M', tier: 'mid', enabled: true, pricing
})

beforeEach(() => {
  useUsageStore.setState({ bySession: {}, lastRoute: {}, diagnostics: {}, hydrated: new Set() })
  ;(window as any).api = {
    db: {
      addUsage: vi.fn().mockResolvedValue({}),
      getUsageBySession: vi.fn().mockResolvedValue([])
    }
  }
})

describe('cost math', () => {
  it('computes cost from per-token rates', () => {
    const m = model({ input: 10, output: 20, cacheRead: 1, cacheWrite: 5 })
    expect(computeCost(m, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 3000 }))
      .toBeCloseTo((1000 * 10 + 500 * 20 + 2000 * 1 + 3000 * 5) / 1_000_000)
  })

  it('returns 0 for models without pricing', () => {
    expect(computeCost(model(), { inputTokens: 1000, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1 })).toBe(0)
  })

  it('computes the uncached counterfactual cost', () => {
    const m = model({ input: 10, output: 20, cacheRead: 1, cacheWrite: 5 })
    expect(computeUncachedCost(m, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 300 }))
      .toBeCloseTo(((100 + 200 + 300) * 10 + 50 * 20) / 1_000_000)
  })
})

describe('formatting', () => {
  it('formats costs with sensible precision', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.0001)).toBe('$0.0001')
    expect(formatCost(0.1234)).toBe('$0.123')
    expect(formatCost(12.34)).toBe('$12.34')
  })

  it('formats token counts', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(2_500_000)).toBe('2.50M')
  })
})

describe('record', () => {
  it('aggregates totals and hit rate per session', () => {
    const m = model({ input: 10, output: 20, cacheRead: 1, cacheWrite: 5 })
    useUsageStore.getState().record('s1', m, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 100 })
    useUsageStore.getState().record('s1', m, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 100 })
    useUsageStore.getState().record('s2', m, { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

    const totals = useUsageStore.getState().totalsFor('s1')
    expect(totals.calls).toBe(2)
    expect(totals.inputTokens).toBe(200)
    expect(totals.cacheReadTokens).toBe(600)
    expect(totals.cacheWriteTokens).toBe(200)
    expect(totals.cacheHitRate).toBeCloseTo(600 / 1000)
    expect(totals.cost).toBeCloseTo(2 * computeCost(m, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 100 }))

    expect(useUsageStore.getState().totalsFor('s2').calls).toBe(1)
  })

  it('accumulates the money saved by the cache', () => {
    const m = model({ input: 10, output: 20, cacheRead: 1, cacheWrite: 5 })
    const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 100 }
    useUsageStore.getState().record('s1', m, usage)
    const totals = useUsageStore.getState().totalsFor('s1')
    expect(totals.savedCost).toBeCloseTo(computeUncachedCost(m, usage) - computeCost(m, usage))
    expect(totals.savedCost).toBeGreaterThan(0)
  })

  it('hydrates totals from durable session rows', async () => {
    const getUsageBySession = vi.fn().mockResolvedValue([
      {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 0,
        cost: 0.01
      },
      {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.002
      }
    ])
    ;(window as any).api.db.getUsageBySession = getUsageBySession
    await useUsageStore.getState().hydrateSession('sess-1')
    const t = useUsageStore.getState().totalsFor('sess-1')
    expect(t.calls).toBe(2)
    expect(t.inputTokens).toBe(110)
    expect(t.cost).toBeCloseTo(0.012)
    // Second hydrate is a no-op
    await useUsageStore.getState().hydrateSession('sess-1')
    expect(getUsageBySession).toHaveBeenCalledTimes(1)
  })

  it('persists each call through window.api.db.addUsage', () => {
    const m = model({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 })
    useUsageStore.getState().record('s', m, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const addUsage = (window as any).api.db.addUsage as ReturnType<typeof vi.fn>
    expect(addUsage).toHaveBeenCalledTimes(1)
    const row = addUsage.mock.calls[0][0]
    expect(row.sessionId).toBe('s')
    expect(row.modelId).toBe('m')
    expect(row.cost).toBeCloseTo((10 * 1 + 5 * 2) / 1_000_000)
  })

  it('emits cache diagnostics for misses and warm reads', () => {
    const m = model({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 })
    useUsageStore.getState().record('s', m, { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(diagnosticsFor('s')[0].level).toBe('warn')

    useUsageStore.getState().record('s', m, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 90, cacheWriteTokens: 10 })
    const diags = diagnosticsFor('s')
    expect(diags.length).toBe(2)
    expect(diags[1].level).toBe('info')
    expect(diags[1].message).toContain('cache hit')
  })

  it('keeps at most 20 diagnostics per session and resets state', () => {
    const m = model()
    for (let i = 0; i < 25; i++) {
      useUsageStore.getState().noteDiagnostic('s', 'info', `d${i}`)
    }
    expect(diagnosticsFor('s')).toHaveLength(20)
    expect(diagnosticsFor('s')[0].message).toBe('d5')

    useUsageStore.getState().reset('s')
    expect(useUsageStore.getState().totalsFor('s').calls).toBe(0)
    expect(diagnosticsFor('s')).toHaveLength(0)
  })

  it('tracks the last route label', () => {
    useUsageStore.getState().noteRoute('s', 'gpt-4o', 'auto: medium')
    expect(useUsageStore.getState().lastRoute.s).toEqual({ label: 'gpt-4o', reason: 'auto: medium' })
  })
})
