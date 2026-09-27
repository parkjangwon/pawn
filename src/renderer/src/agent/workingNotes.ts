/**
 * Working notes: the agent's own scratchpad per session. The latest notes
 * always live in the transcript (every working_notes result carries the full
 * text), survive tool-result clearing and are carried through compaction —
 * so this map is only a cache, re-hydrated from the transcript each turn.
 */

import { notesFromTranscript } from './contextEditing'
import type { TranscriptEntry } from './transcript'

export const NOTES_MAX_CHARS = 8_000

const notes = new Map<string, string>()

export function getNotes(sessionKey: string): string {
  return notes.get(sessionKey) || ''
}

export function setNotes(sessionKey: string, text: string): void {
  if (text) notes.set(sessionKey, text.slice(0, NOTES_MAX_CHARS))
  else notes.delete(sessionKey)
}

export function hydrateNotes(sessionKey: string, entries: TranscriptEntry[]): string {
  const text = notesFromTranscript(entries)
  setNotes(sessionKey, text)
  return text
}
