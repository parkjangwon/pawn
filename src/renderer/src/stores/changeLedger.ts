import { create } from 'zustand'

/** Max chars of file content kept for undo (per side). Larger files skip revert. */
export const LEDGER_CONTENT_CAP = 2 * 1024 * 1024

export type FileChangeOp = 'write' | 'edit' | 'delete'

export interface FileChange {
  path: string
  rel?: string
  /** Content before the change; null means the file was created this turn. */
  before: string | null
  after?: string
  op: FileChangeOp
  toolCallId?: string
  status: 'applied' | 'reverted'
  oversized?: boolean
}

export interface TurnCheckpoint {
  id: string
  sessionId: string
  projectId: string
  createdAt: number
  label: string
  changes: FileChange[]
}

interface ChangeLedgerState {
  turns: TurnCheckpoint[]
  activeTurnId: string | null
  beginTurn: (sessionId: string, projectId: string, label: string) => string
  endTurn: () => void
  recordChange: (change: Omit<FileChange, 'status'>) => void
  revertFile: (path: string) => Promise<{ ok: boolean; error?: string }>
  revertTurn: (turnId?: string) => Promise<{ ok: boolean; reverted: number; error?: string }>
  latestTurn: (sessionId?: string | null) => TurnCheckpoint | null
  clearSession: (sessionId: string) => void
}

function capContent(s: string | null | undefined): { text: string | null; oversized: boolean } {
  if (s == null) return { text: null, oversized: false }
  if (s.length <= LEDGER_CONTENT_CAP) return { text: s, oversized: false }
  return { text: s.slice(0, LEDGER_CONTENT_CAP), oversized: true }
}

export const useChangeLedger = create<ChangeLedgerState>((set, get) => ({
  turns: [],
  activeTurnId: null,

  beginTurn: (sessionId, projectId, label) => {
    const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const turn: TurnCheckpoint = {
      id,
      sessionId,
      projectId,
      createdAt: Date.now(),
      label: label.slice(0, 80),
      changes: []
    }
    set((s) => ({
      turns: [...s.turns.slice(-40), turn],
      activeTurnId: id
    }))
    return id
  },

  endTurn: () => set({ activeTurnId: null }),

  recordChange: (change) => {
    const { activeTurnId, turns } = get()
    if (!activeTurnId) return
    const beforeCap = capContent(change.before)
    const afterCap = capContent(change.after)
    const entry: FileChange = {
      ...change,
      before: beforeCap.text,
      after: afterCap.text ?? undefined,
      oversized: beforeCap.oversized || afterCap.oversized || change.oversized,
      status: 'applied'
    }
    set({
      turns: turns.map((t) => {
        if (t.id !== activeTurnId) return t
        const existing = t.changes.find((c) => c.path === entry.path && c.status === 'applied')
        if (existing) {
          return {
            ...t,
            changes: t.changes.map((c) =>
              c.path === entry.path && c.status === 'applied'
                ? {
                    ...c,
                    after: entry.after,
                    op: entry.op === 'delete' ? 'delete' : c.op,
                    toolCallId: entry.toolCallId ?? c.toolCallId,
                    oversized: c.oversized || entry.oversized
                  }
                : c
            )
          }
        }
        return { ...t, changes: [...t.changes, entry] }
      })
    })
  },

  revertFile: async (path) => {
    const turn = get().latestTurn()
    if (!turn) return { ok: false, error: 'No changes to revert' }
    const change = [...turn.changes].reverse().find((c) => c.path === path && c.status === 'applied')
    if (!change) return { ok: false, error: 'File not in latest turn' }
    if (change.oversized) {
      return { ok: false, error: 'File too large to auto-revert; restore from git or backup' }
    }
    try {
      if (change.before === null) {
        const res = await window.api.fs.delete(path)
        if (res && 'error' in res && res.error) return { ok: false, error: res.error }
      } else {
        const res = await window.api.fs.writeFile(path, change.before)
        if (res && 'error' in res && res.error) return { ok: false, error: res.error }
      }
      set((s) => ({
        turns: s.turns.map((t) =>
          t.id !== turn.id
            ? t
            : {
                ...t,
                changes: t.changes.map((c) =>
                  c.path === path && c.status === 'applied' ? { ...c, status: 'reverted' as const } : c
                )
              }
        )
      }))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },

  revertTurn: async (turnId) => {
    const turn = turnId
      ? get().turns.find((t) => t.id === turnId)
      : get().latestTurn()
    if (!turn) return { ok: false, reverted: 0, error: 'No turn to revert' }
    const applied = [...turn.changes].filter((c) => c.status === 'applied').reverse()
    let reverted = 0
    const errors: string[] = []
    for (const change of applied) {
      if (change.oversized) {
        errors.push(`${change.path}: oversized`)
        continue
      }
      try {
        if (change.before === null) {
          const res = await window.api.fs.delete(change.path)
          if (res && 'error' in res && res.error) {
            errors.push(`${change.path}: ${res.error}`)
            continue
          }
        } else {
          const res = await window.api.fs.writeFile(change.path, change.before)
          if (res && 'error' in res && res.error) {
            errors.push(`${change.path}: ${res.error}`)
            continue
          }
        }
        reverted++
        set((s) => ({
          turns: s.turns.map((t) =>
            t.id !== turn.id
              ? t
              : {
                  ...t,
                  changes: t.changes.map((c) =>
                    c.path === change.path && c.status === 'applied'
                      ? { ...c, status: 'reverted' as const }
                      : c
                  )
                }
          )
        }))
      } catch (err) {
        errors.push(`${change.path}: ${String(err)}`)
      }
    }
    return {
      ok: reverted > 0,
      reverted,
      error: errors.length ? errors.slice(0, 3).join('; ') : undefined
    }
  },

  latestTurn: (sessionId) => {
    const turns = get().turns
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]
      if (sessionId && t.sessionId !== sessionId) continue
      if (t.changes.some((c) => c.status === 'applied')) return t
    }
    return null
  },

  clearSession: (sessionId) => {
    set((s) => ({
      turns: s.turns.filter((t) => t.sessionId !== sessionId),
      activeTurnId:
        s.turns.find((t) => t.id === s.activeTurnId)?.sessionId === sessionId ? null : s.activeTurnId
    }))
  }
}))
