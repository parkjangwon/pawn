import { create } from 'zustand'
import { enqueueDbWrite } from '../utils/dbWriteQueue'

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
  hydrated: boolean
  beginTurn: (sessionId: string, projectId: string, label: string) => string
  endTurn: () => void
  recordChange: (change: Omit<FileChange, 'status'>) => void
  revertFile: (path: string) => Promise<{ ok: boolean; error?: string }>
  revertTurn: (turnId?: string) => Promise<{ ok: boolean; reverted: number; error?: string }>
  latestTurn: (sessionId?: string | null) => TurnCheckpoint | null
  clearSession: (sessionId: string) => void
  /** Load durable turns from SQLite after app start. */
  hydrate: () => Promise<void>
}

function capContent(s: string | null | undefined): { text: string | null; oversized: boolean } {
  if (s == null) return { text: null, oversized: false }
  if (s.length <= LEDGER_CONTENT_CAP) return { text: s, oversized: false }
  return { text: s.slice(0, LEDGER_CONTENT_CAP), oversized: true }
}

function persistTurn(turn: TurnCheckpoint): void {
  const save = window.api?.db?.saveChangeLedgerTurn
  if (!save) return
  enqueueDbWrite(`changeLedger:${turn.id}`, () =>
    save({
      id: turn.id,
      sessionId: turn.sessionId,
      projectId: turn.projectId,
      createdAt: turn.createdAt,
      label: turn.label,
      json: JSON.stringify(turn)
    })
  )
}

function findTurn(turns: TurnCheckpoint[], id: string | null): TurnCheckpoint | undefined {
  if (!id) return undefined
  return turns.find((t) => t.id === id)
}

export const useChangeLedger = create<ChangeLedgerState>((set, get) => ({
  turns: [],
  activeTurnId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    const api = window.api?.db
    if (!api?.listChangeLedgerTurns) {
      set({ hydrated: true })
      return
    }
    try {
      const rows = await api.listChangeLedgerTurns(80)
      const turns: TurnCheckpoint[] = []
      for (const row of rows || []) {
        try {
          const parsed = JSON.parse(row.json) as TurnCheckpoint
          if (!parsed?.id || !Array.isArray(parsed.changes)) continue
          turns.push({
            ...parsed,
            id: parsed.id || row.id,
            sessionId: parsed.sessionId || row.sessionId,
            projectId: parsed.projectId || row.projectId,
            createdAt: parsed.createdAt || row.createdAt * 1000,
            label: parsed.label || row.label || ''
          })
        } catch {
          /* skip */
        }
      }
      // Rows come newest-first; keep chronological order in memory.
      turns.sort((a, b) => a.createdAt - b.createdAt)
      set({ turns: turns.slice(-80), hydrated: true })
    } catch {
      set({ hydrated: true })
    }
  },

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
    persistTurn(turn)
    return id
  },

  endTurn: () => {
    const { activeTurnId, turns } = get()
    const turn = findTurn(turns, activeTurnId)
    if (turn) persistTurn(turn)
    set({ activeTurnId: null })
  },

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
    let updated: TurnCheckpoint | null = null
    set({
      turns: turns.map((t) => {
        if (t.id !== activeTurnId) return t
        const existing = t.changes.find((c) => c.path === entry.path && c.status === 'applied')
        let next: TurnCheckpoint
        if (existing) {
          next = {
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
        } else {
          next = { ...t, changes: [...t.changes, entry] }
        }
        updated = next
        return next
      })
    })
    if (updated) persistTurn(updated)
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
      let updated: TurnCheckpoint | null = null
      set((s) => ({
        turns: s.turns.map((t) => {
          if (t.id !== turn.id) return t
          const next = {
            ...t,
            changes: t.changes.map((c) =>
              c.path === path && c.status === 'applied' ? { ...c, status: 'reverted' as const } : c
            )
          }
          updated = next
          return next
        })
      }))
      if (updated) persistTurn(updated)
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
    const latest = get().turns.find((t) => t.id === turn.id)
    if (latest) persistTurn(latest)
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
    const api = window.api?.db
    if (api?.deleteChangeLedgerForSession) {
      enqueueDbWrite(`changeLedgerClear:${sessionId}`, () =>
        api.deleteChangeLedgerForSession!(sessionId)
      )
    }
  }
}))
