import { create } from 'zustand'

export type PlanItemStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'

export interface PlanItem {
  id: string
  content: string
  status: PlanItemStatus
}

interface PlanState {
  bySession: Record<string, PlanItem[]>
  /** Sessions whose plan was loaded from disk this run. */
  hydrated: Set<string>
  setPlan: (sessionId: string, items: PlanItem[]) => void
  updatePlan: (
    sessionId: string,
    items: Array<{ id?: string; content: string; status?: PlanItemStatus }>
  ) => PlanItem[]
  clearPlan: (sessionId: string) => void
  getPlan: (sessionId: string) => PlanItem[]
  hydrate: (sessionId: string) => Promise<void>
}

function uid(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function persist(sessionId: string, items: PlanItem[]): void {
  try {
    void window.api?.db?.saveSessionPlan?.(sessionId, JSON.stringify(items))?.catch?.(() => {})
  } catch {
    /* node tests / no window */
  }
}

export const usePlanStore = create<PlanState>((set, get) => ({
  bySession: {},
  hydrated: new Set(),

  setPlan: (sessionId, items) => {
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: items } }))
    persist(sessionId, items)
  },

  updatePlan: (sessionId, items) => {
    const next: PlanItem[] = items.map((it, i) => ({
      id: it.id || uid() + String(i),
      content: String(it.content || '').slice(0, 500),
      status: (it.status as PlanItemStatus) || 'pending'
    }))
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: next } }))
    persist(sessionId, next)
    return next
  },

  clearPlan: (sessionId) => {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.bySession
      return { bySession: rest }
    })
    persist(sessionId, [])
  },

  getPlan: (sessionId) => get().bySession[sessionId] || [],

  hydrate: async (sessionId) => {
    if (!sessionId || get().hydrated.has(sessionId)) return
    set((s) => ({ hydrated: new Set(s.hydrated).add(sessionId) }))
    try {
      const raw = await window.api?.db?.getSessionPlan?.(sessionId)
      if (!raw) return
      const parsed = JSON.parse(raw) as PlanItem[]
      if (!Array.isArray(parsed)) return
      set((s) => ({
        bySession: {
          ...s.bySession,
          [sessionId]: parsed.map((it) => ({
            id: String(it.id || uid()),
            content: String(it.content || '').slice(0, 500),
            status: (it.status as PlanItemStatus) || 'pending'
          }))
        }
      }))
    } catch {
      /* optional */
    }
  }
}))
