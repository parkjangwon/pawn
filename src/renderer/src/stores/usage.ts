import { create } from 'zustand'
import { uid } from '../utils/uid'
import type { ModelEntry } from '../types/provider'

/** Raw token counts reported by a provider for a single request. */
export interface CallUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface UsageRecord extends CallUsage {
  id: string
  sessionId: string
  providerId: string
  modelId: string
  cost: number
  createdAt: number
}

export interface UsageTotals extends CallUsage {
  calls: number
  cost: number
  /** cacheRead / (cacheRead + input) — the fraction of prompt tokens served from cache. */
  cacheHitRate: number
}

interface UsageState {
  /** Per-session running totals for the current app run. */
  bySession: Record<string, UsageTotals>
  lastRoute: Record<string, { label: string; reason: string }>
  record: (sessionId: string, model: ModelEntry, usage: CallUsage) => void
  noteRoute: (sessionId: string, label: string, reason: string) => void
  reset: (sessionId: string) => void
  totalsFor: (sessionId: string) => UsageTotals
}

const EMPTY: UsageTotals = {
  calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, cacheHitRate: 0
}

/**
 * USD cost of one call. Cache reads and cache writes are billed at their own
 * rates, so a call with a warm prefix can cost an order of magnitude less than
 * the same call cold — this is the number that makes caching visible.
 */
export function computeCost(model: ModelEntry, u: CallUsage): number {
  const p = model.pricing
  if (!p) return 0
  return (
    u.inputTokens * p.input +
    u.outputTokens * p.output +
    u.cacheReadTokens * p.cacheRead +
    u.cacheWriteTokens * p.cacheWrite
  ) / 1_000_000
}

/** What the same call would have cost with no caching at all. */
export function computeUncachedCost(model: ModelEntry, u: CallUsage): number {
  const p = model.pricing
  if (!p) return 0
  const promptTokens = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens
  return (promptTokens * p.input + u.outputTokens * p.output) / 1_000_000
}

export const useUsageStore = create<UsageState>((set, get) => ({
  bySession: {},
  lastRoute: {},

  record: (sessionId, model, usage) => {
    const cost = computeCost(model, usage)
    set((s) => {
      const prev = s.bySession[sessionId] || EMPTY
      const next: UsageTotals = {
        calls: prev.calls + 1,
        inputTokens: prev.inputTokens + usage.inputTokens,
        outputTokens: prev.outputTokens + usage.outputTokens,
        cacheReadTokens: prev.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: prev.cacheWriteTokens + usage.cacheWriteTokens,
        cost: prev.cost + cost,
        cacheHitRate: 0
      }
      const prompt = next.inputTokens + next.cacheReadTokens + next.cacheWriteTokens
      next.cacheHitRate = prompt > 0 ? next.cacheReadTokens / prompt : 0
      return { bySession: { ...s.bySession, [sessionId]: next } }
    })

    window.api.db
      .addUsage({
        id: uid(),
        sessionId,
        providerId: model.providerId,
        modelId: model.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        cost
      })
      .catch(() => {
        // Accounting is best-effort; a write failure must never break a turn.
      })
  },

  noteRoute: (sessionId, label, reason) =>
    set((s) => ({ lastRoute: { ...s.lastRoute, [sessionId]: { label, reason } } })),

  reset: (sessionId) =>
    set((s) => {
      const next = { ...s.bySession }
      delete next[sessionId]
      return { bySession: next }
    }),

  totalsFor: (sessionId) => get().bySession[sessionId] || EMPTY
}))

export function formatCost(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
