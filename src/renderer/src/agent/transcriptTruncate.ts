/**
 * Truncate durable transcripts at user-message boundaries without dropping
 * tool pairs / thinking / reasoningContent for kept history.
 */

import type { TranscriptEntry } from './transcript'

/** Count user-role entries in the transcript. */
export function countUserEntries(entries: TranscriptEntry[]): number {
  return entries.filter((e) => e.role === 'user').length
}

/**
 * Keep transcript entries strictly before the Nth user message (0-based).
 * Used when editing/replacing that user turn.
 */
export function truncateBeforeUserIndex(
  entries: TranscriptEntry[],
  userIndex: number
): TranscriptEntry[] {
  if (userIndex <= 0) return []
  let seen = 0
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].role === 'user') {
      if (seen === userIndex) {
        return entries.slice(0, i)
      }
      seen++
    }
  }
  // userIndex past end → keep all
  return entries.slice()
}

/**
 * Keep through the Nth user message (inclusive), drop everything after.
 * Used when regenerating the assistant reply to that user turn.
 */
export function truncateAfterUserIndex(
  entries: TranscriptEntry[],
  userIndex: number
): TranscriptEntry[] {
  if (userIndex < 0) return []
  let seen = 0
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].role === 'user') {
      if (seen === userIndex) {
        // Include this user entry; drop following assistant/tool/summary.
        return entries.slice(0, i + 1)
      }
      seen++
    }
  }
  return entries.slice()
}

/** Find 0-based user-message index in display messages. */
export function displayUserIndex(
  messages: Array<{ id: string; role: string }>,
  messageId: string
): number {
  let n = 0
  for (const m of messages) {
    if (m.role !== 'user') continue
    if (m.id === messageId) return n
    n++
  }
  return -1
}

/**
 * Drop a trailing assistant that still expects tool results (no tool entries after it).
 * Complete tool pairs at the end are kept intact.
 */
export function sealTranscriptTail(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (!entries.length) return entries
  const out = entries.slice()
  const last = out[out.length - 1]
  // Orphan tool_use: assistant ended with toolCalls but no following tool results.
  if (last?.role === 'assistant' && last.toolCalls?.length) {
    out.pop()
  }
  return out
}
