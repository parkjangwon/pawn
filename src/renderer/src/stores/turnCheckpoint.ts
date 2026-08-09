/**
 * Durable mid-turn agent checkpoints so a crash/restart can resume work.
 * Payload lives in SQLite via db.saveTurnCheckpoint / listRunningTurnCheckpoints.
 */
import type { TranscriptEntry } from '../agent/transcript'
import type { ModelTier } from '../types/provider'
import type { Complexity } from '../agent/router'
import type { ChatAttachment } from '../utils/attachments'
import { enqueueDbWrite } from '../utils/dbWriteQueue'

export const TURN_CHECKPOINT_VERSION = 1 as const

export interface AgentTurnCheckpoint {
  version: typeof TURN_CHECKPOINT_VERSION
  projectId: string
  sessionId: string
  userContent: string
  attachments?: ChatAttachment[]
  entries: TranscriptEntry[]
  round: number
  consecutiveToolErrors: number
  emptyResponses: number
  complexity: Complexity
  turnHadCodeEdits: boolean
  turnRanChecks: boolean
  autoVerifyDone: boolean
  warmFor?: string
  warmTier?: ModelTier
  /** User bubble already in the UI; resume must not re-append it. */
  userMessageAppended: boolean
  lastActivity: number
}

export type TurnCheckpointStatus = 'running' | 'completed' | 'aborted'

export function saveTurnCheckpoint(cp: AgentTurnCheckpoint): void {
  const payload = JSON.stringify({ ...cp, lastActivity: Date.now() })
  const save = window.api?.db?.saveTurnCheckpoint
  if (!save) return
  enqueueDbWrite(`turnCheckpoint:${cp.sessionId}`, () =>
    save(cp.sessionId, cp.projectId, 'running', payload)
  )
}

export function clearTurnCheckpoint(
  sessionId: string,
  status: TurnCheckpointStatus = 'completed'
): void {
  const clear = window.api?.db?.clearTurnCheckpoint
  if (!clear) return
  enqueueDbWrite(`turnCheckpointClear:${sessionId}`, () => clear(sessionId, status))
}

export async function listRunningTurnCheckpoints(): Promise<AgentTurnCheckpoint[]> {
  const api = window.api?.db
  if (!api?.listRunningTurnCheckpoints) return []
  try {
    const rows = await api.listRunningTurnCheckpoints()
    if (!Array.isArray(rows)) return []
    const out: AgentTurnCheckpoint[] = []
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.json) as AgentTurnCheckpoint
        if (parsed?.version !== TURN_CHECKPOINT_VERSION) continue
        if (!parsed.sessionId || !parsed.projectId) continue
        // Stale checkpoints older than 24h are abandoned (user can re-prompt).
        if (parsed.lastActivity && Date.now() - parsed.lastActivity > 24 * 60 * 60 * 1000) {
          clearTurnCheckpoint(parsed.sessionId, 'aborted')
          continue
        }
        out.push(parsed)
      } catch {
        /* skip corrupt */
      }
    }
    return out
  } catch {
    return []
  }
}
