/**
 * Named checkpoints inside a session: `checkpoint_mark` snapshots every file
 * the agent has touched so far; `checkpoint_restore` puts all agent-touched
 * files back to that moment (files first touched after the mark return to
 * their pre-agent content). Restores go through the change ledger, so they
 * can be undone too.
 */

import { useChangeLedger } from '../stores/changeLedger'
import type { FileWrite } from './fileTransaction'

export interface Checkpoint {
  label: string
  at: number
  /** path → content at mark time (null = did not exist). */
  files: Map<string, string | null>
}

const MAX_MARKS = 12
const marks = new Map<string, Checkpoint[]>()

function sessionPaths(sessionId: string): Map<string, string | null> {
  // path → content before the agent's first touch in this session.
  const firstBefore = new Map<string, string | null>()
  for (const turn of useChangeLedger.getState().turns) {
    if (turn.sessionId !== sessionId) continue
    for (const c of turn.changes) {
      if (c.status !== 'applied' || c.oversized) continue
      if (!firstBefore.has(c.path)) firstBefore.set(c.path, c.before)
    }
  }
  return firstBefore
}

export async function markCheckpoint(
  sessionId: string,
  label: string,
  readFile: (p: string) => Promise<string | null>
): Promise<Checkpoint> {
  const files = new Map<string, string | null>()
  for (const path of Array.from(sessionPaths(sessionId).keys())) files.set(path, await readFile(path))
  const cp: Checkpoint = { label: label.trim().slice(0, 80) || `mark-${Date.now()}`, at: Date.now(), files }
  const list = (marks.get(sessionId) || []).filter((m) => m.label !== cp.label)
  list.push(cp)
  marks.set(sessionId, list.slice(-MAX_MARKS))
  return cp
}

export function listCheckpoints(sessionId: string): Checkpoint[] {
  return marks.get(sessionId) || []
}

export function findCheckpoint(sessionId: string, label?: string): Checkpoint | null {
  const list = marks.get(sessionId) || []
  if (!list.length) return null
  if (!label) return list[list.length - 1]
  return list.find((m) => m.label === label) ?? null
}

/** Writes that bring every agent-touched file back to checkpoint `cp`. */
export async function planRestore(
  sessionId: string,
  cp: Checkpoint,
  readFile: (p: string) => Promise<string | null>
): Promise<FileWrite[]> {
  const writes: FileWrite[] = []
  const firstBefore = sessionPaths(sessionId)
  const paths = new Set<string>([...Array.from(cp.files.keys()), ...Array.from(firstBefore.keys())])
  for (const path of Array.from(paths)) {
    const target = cp.files.has(path) ? cp.files.get(path)! : firstBefore.get(path) ?? null
    const current = await readFile(path)
    if (current === target) continue
    if (current === null && target === null) continue
    writes.push({ path, before: current, after: target })
  }
  return writes
}

export function clearCheckpoints(sessionId: string): void {
  marks.delete(sessionId)
}
