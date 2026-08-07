/**
 * Live subagent run registry for UI observability.
 * Updated by the nested agent runner; read by StatusBar / ToolMessage.
 */
import { create } from 'zustand'

export type SubagentRunStatus = 'running' | 'ok' | 'error' | 'aborted'

export type SubagentRun = {
  id: string
  name: string
  mode: 'explore' | 'worker'
  status: SubagentRunStatus
  parentSessionId: string
  startedAt: number
  finishedAt?: number
  rounds: number
  toolsUsed: string[]
  isolation?: 'none' | 'worktree'
  worktreePath?: string
  summary?: string
  error?: string
}

interface SubagentRunsState {
  runs: SubagentRun[]
  start: (run: Omit<SubagentRun, 'status' | 'startedAt' | 'rounds' | 'toolsUsed'> & {
    rounds?: number
    toolsUsed?: string[]
  }) => void
  tick: (id: string, patch: Partial<Pick<SubagentRun, 'rounds' | 'toolsUsed'>>) => void
  finish: (
    id: string,
    patch: {
      status: SubagentRunStatus
      summary?: string
      error?: string
      rounds?: number
      toolsUsed?: string[]
    }
  ) => void
  clearFinished: () => void
  activeForSession: (sessionId: string) => SubagentRun[]
  recentForSession: (sessionId: string, limit?: number) => SubagentRun[]
}

const MAX_HISTORY = 40

export const useSubagentRunsStore = create<SubagentRunsState>((set, get) => ({
  runs: [],

  start: (run) => {
    const entry: SubagentRun = {
      ...run,
      status: 'running' as const,
      startedAt: Date.now(),
      rounds: run.rounds ?? 0,
      toolsUsed: run.toolsUsed ?? []
    }
    set((s) => ({
      runs: [entry, ...s.runs].slice(0, MAX_HISTORY)
    }))
  },

  tick: (id, patch) => {
    set((s) => ({
      runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r))
    }))
  },

  finish: (id, patch) => {
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              finishedAt: Date.now()
            }
          : r
      )
    }))
  },

  clearFinished: () => {
    set((s) => ({ runs: s.runs.filter((r) => r.status === 'running') }))
  },

  activeForSession: (sessionId) =>
    get().runs.filter((r) => r.parentSessionId === sessionId && r.status === 'running'),

  recentForSession: (sessionId, limit = 8) =>
    get()
      .runs.filter((r) => r.parentSessionId === sessionId)
      .slice(0, limit)
}))
