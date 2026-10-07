/**
 * Decision models (Settings → Decision models). The main process owns the
 * config and the API keys; this store mirrors the key-free status so the
 * Settings panel and the harness (decide tool, shell risk check, routing
 * assist) can read it synchronously.
 */

import { create } from 'zustand'

type SaveInput = Parameters<NonNullable<typeof window.api.decision>['saveProvider']>[0]

interface DecisionState {
  status: DecisionStatusDto | null
  /** Epoch ms of the last successful status read. */
  fetchedAt: number
  /** False when the host has no decision API (web preview). */
  available: boolean
  refresh: () => Promise<DecisionStatusDto | null>
  saveProvider: (input: SaveInput) => Promise<{ ok: boolean; error?: string; id?: string }>
  removeProvider: (id: string) => Promise<{ ok: boolean; error?: string }>
  setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  setFeatures: (partial: Partial<DecisionFeaturesDto>) => Promise<void>
}

function api(): NonNullable<typeof window.api.decision> | null {
  const d = typeof window !== 'undefined' ? window.api?.decision : undefined
  return d && typeof d.status === 'function' ? d : null
}

function isStatus(v: unknown): v is DecisionStatusDto {
  return !!v && typeof v === 'object' && Array.isArray((v as DecisionStatusDto).providers) && !!(v as DecisionStatusDto).features
}

export const useDecisionStore = create<DecisionState>((set, get) => {
  const apply = (s: unknown): void => {
    if (isStatus(s)) set({ status: s, fetchedAt: Date.now(), available: true })
  }
  return {
    status: null,
    fetchedAt: 0,
    available: true,

    refresh: async () => {
      const d = api()
      if (!d) {
        set({ available: false, status: null })
        return null
      }
      try {
        const s = await d.status()
        apply(s)
        return isStatus(s) ? s : null
      } catch {
        return null
      }
    },

    saveProvider: async (input) => {
      const d = api()
      if (!d) return { ok: false, error: 'Decision models are only available in the desktop app.' }
      try {
        const r = await d.saveProvider(input)
        if (r.ok) {
          apply(r.status)
          return { ok: true, id: r.id }
        }
        return { ok: false, error: r.error }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    removeProvider: async (id) => {
      const d = api()
      if (!d) return { ok: false }
      try {
        const r = await d.removeProvider(id)
        apply(r.status)
        return { ok: r.ok, error: r.error }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    setEnabled: async (id, enabled) => {
      const d = api()
      if (!d) return { ok: false }
      try {
        const r = await d.setEnabled(id, enabled)
        apply(r.status)
        return { ok: r.ok, error: r.error }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    setFeatures: async (partial) => {
      const d = api()
      if (!d) return
      // Optimistic so toggles feel instant; the reply re-syncs.
      set((s) => (s.status ? { status: { ...s.status, features: { ...s.status.features, ...partial } } } : s))
      try {
        const r = await d.setFeatures(partial)
        apply(r.status)
      } catch (err) {
        // Roll the optimistic toggle back and let the caller show why.
        const status = get().status
        if (status) {
          const reverted = { ...status.features }
          for (const [k, v] of Object.entries(partial)) {
            reverted[k as keyof DecisionFeaturesDto] = !v as never
          }
          set({ status: { ...status, features: reverted } })
        }
        throw err instanceof Error ? err : new Error(String(err))
      }
    }
  }
})
