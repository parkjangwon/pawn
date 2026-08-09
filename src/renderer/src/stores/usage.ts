import { create } from 'zustand'
import { uid } from '../utils/uid'
import type { ModelEntry } from '../types/provider'
import i18n from '../i18n'

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
  /** Money the cache saved vs the same calls with no cache. */
  savedCost: number
  /** cacheRead / (cacheRead + input) — the fraction of prompt tokens served from cache. */
  cacheHitRate: number
}

export type CacheDiagnosticLevel = 'info' | 'warn'

export interface CacheDiagnostic {
  level: CacheDiagnosticLevel
  message: string
  at: number
}

interface UsageState {
  /** Per-session running totals for the current app run. */
  bySession: Record<string, UsageTotals>
  lastRoute: Record<string, { label: string; reason: string }>
  /** Per-session cache diagnostics — helps the user understand why costs vary. */
  diagnostics: Record<string, CacheDiagnostic[]>
  /** Sessions already loaded from SQLite (avoid re-hydrate wiping live totals). */
  hydrated: Set<string>
  record: (sessionId: string, model: ModelEntry, usage: CallUsage) => void
  noteRoute: (sessionId: string, label: string, reason: string) => void
  noteDiagnostic: (sessionId: string, level: CacheDiagnosticLevel, message: string) => void
  /** Load durable usage rows for a session after reload / switch. */
  hydrateSession: (sessionId: string) => Promise<void>
  reset: (sessionId: string) => void
  totalsFor: (sessionId: string) => UsageTotals
}

const EMPTY: UsageTotals = {
  calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  cost: 0, savedCost: 0, cacheHitRate: 0
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
  diagnostics: {},
  hydrated: new Set(),

  record: (sessionId, model, usage) => {
    const cost = computeCost(model, usage)
    const savedCost = Math.max(0, computeUncachedCost(model, usage) - cost)
    set((s) => {
      const prev = s.bySession[sessionId] || EMPTY
      const next: UsageTotals = {
        calls: prev.calls + 1,
        inputTokens: prev.inputTokens + usage.inputTokens,
        outputTokens: prev.outputTokens + usage.outputTokens,
        cacheReadTokens: prev.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: prev.cacheWriteTokens + usage.cacheWriteTokens,
        cost: prev.cost + cost,
        savedCost: prev.savedCost + savedCost,
        cacheHitRate: 0
      }
      const prompt = next.inputTokens + next.cacheReadTokens + next.cacheWriteTokens
      next.cacheHitRate = prompt > 0 ? next.cacheReadTokens / prompt : 0

      // Generate a diagnostic based on this call's cache performance so the
      // user can see *why* a session is cheap or expensive.
      const diags: CacheDiagnostic[] = []
      const callPrompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
      if (callPrompt > 0) {
        if (usage.cacheReadTokens === 0 && usage.cacheWriteTokens === 0) {
          diags.push({ level: 'warn', message: i18n.t('usage.diagnostics.cacheMiss'), at: Date.now() })
        } else if (usage.cacheWriteTokens > usage.inputTokens && usage.cacheReadTokens === 0) {
          diags.push({ level: 'info', message: i18n.t('usage.diagnostics.cachePriming'), at: Date.now() })
        } else if (usage.cacheReadTokens > callPrompt * 0.8) {
          diags.push({ level: 'info', message: i18n.t('usage.diagnostics.cacheHit'), at: Date.now() })
        }
      }
      const prevDiags = s.diagnostics[sessionId] || []
      const allDiags = [...prevDiags, ...diags].slice(-20)

      return {
        bySession: { ...s.bySession, [sessionId]: next },
        diagnostics: { ...s.diagnostics, [sessionId]: allDiags }
      }
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

  noteDiagnostic: (sessionId, level, message) =>
    set((s) => {
      const prev = s.diagnostics[sessionId] || []
      const all = [...prev, { level, message, at: Date.now() }].slice(-20)
      return { diagnostics: { ...s.diagnostics, [sessionId]: all } }
    }),

  hydrateSession: async (sessionId) => {
    if (!sessionId || get().hydrated.has(sessionId)) return
    // Mark first so concurrent hydrate calls don't double-fetch.
    set((s) => ({ hydrated: new Set(s.hydrated).add(sessionId) }))
    try {
      const rows = await window.api?.db?.getUsageBySession?.(sessionId)
      if (!Array.isArray(rows) || rows.length === 0) return
      // Don't clobber live totals if the session already recorded this run.
      if ((get().bySession[sessionId]?.calls || 0) > 0) return
      const next: UsageTotals = { ...EMPTY }
      for (const row of rows) {
        next.calls++
        next.inputTokens += Number(row.inputTokens) || 0
        next.outputTokens += Number(row.outputTokens) || 0
        next.cacheReadTokens += Number(row.cacheReadTokens) || 0
        next.cacheWriteTokens += Number(row.cacheWriteTokens) || 0
        next.cost += Number(row.cost) || 0
      }
      const prompt = next.inputTokens + next.cacheReadTokens + next.cacheWriteTokens
      next.cacheHitRate = prompt > 0 ? next.cacheReadTokens / prompt : 0
      set((s) => ({
        bySession: { ...s.bySession, [sessionId]: next }
      }))
    } catch {
      /* optional */
    }
  },

  reset: (sessionId) =>
    set((s) => {
      const next = { ...s.bySession }
      delete next[sessionId]
      const nextDiags = { ...s.diagnostics }
      delete nextDiags[sessionId]
      const hyd = new Set(s.hydrated)
      hyd.delete(sessionId)
      return { bySession: next, diagnostics: nextDiags, hydrated: hyd }
    }),

  totalsFor: (sessionId) => get().bySession[sessionId] || EMPTY
}))

export function diagnosticsFor(sessionId: string): CacheDiagnostic[] {
  return useUsageStore.getState().diagnostics[sessionId] || []
}

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
