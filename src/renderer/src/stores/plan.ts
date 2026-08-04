import { create } from 'zustand'

export type PlanItemStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'

export interface PlanItem {
  id: string
  content: string
  status: PlanItemStatus
}

interface PlanState {
  bySession: Record<string, PlanItem[]>
  setPlan: (sessionId: string, items: PlanItem[]) => void
  updatePlan: (
    sessionId: string,
    items: Array<{ id?: string; content: string; status?: PlanItemStatus }>
  ) => PlanItem[]
  clearPlan: (sessionId: string) => void
  getPlan: (sessionId: string) => PlanItem[]
}

function uid(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export const usePlanStore = create<PlanState>((set, get) => ({
  bySession: {},

  setPlan: (sessionId, items) => {
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: items } }))
  },

  updatePlan: (sessionId, items) => {
    const next: PlanItem[] = items.map((it, i) => ({
      id: it.id || uid() + String(i),
      content: String(it.content || '').slice(0, 500),
      status: (it.status as PlanItemStatus) || 'pending'
    }))
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: next } }))
    return next
  },

  clearPlan: (sessionId) => {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.bySession
      return { bySession: rest }
    })
  },

  getPlan: (sessionId) => get().bySession[sessionId] || []
}))
