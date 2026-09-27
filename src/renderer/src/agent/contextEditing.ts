/**
 * Context endurance: clear stale tool results before the transcript needs a
 * full compaction.
 *
 * Old file reads, searches and command logs are the bulk of a long session,
 * and the agent rarely needs them verbatim once it has acted on them. Clearing
 * them (oldest first, in one sizeable batch so the prompt-cache re-prime is
 * worth it) keeps the reasoning, decisions and recent results intact — a much
 * gentler step than summarizing the whole history. Cleared content is saved
 * as an offloaded output first, so nothing is lost: the placeholder tells the
 * agent how to get it back.
 */

import { estimateCharsAsTokens, extractImageDataUrl, type TranscriptEntry } from './transcript'

/** Never cleared: small, authoritative, or needed to continue. */
export const CLEAR_EXEMPT = new Set([
  'update_plan',
  'working_notes',
  'ask_user',
  'request_plan_approval',
  'load_skill',
  'load_tools',
  'project_profile',
  'checkpoint_mark'
])

export const CLEARED_PREFIX = '[cleared to save context'

export interface ClearOptions {
  /** At most this many recent tool results are kept verbatim… */
  keepRecent?: number
  /** …while they fit this token budget… */
  keepRecentTokens?: number
  /** …but always at least this many. */
  minKeep?: number
  /** Results shorter than this are left alone (cheap and often decisive). */
  minChars?: number
  /** Stop once this many tokens were cleared. */
  targetTokens?: number
  /** Do nothing unless at least this many tokens can be cleared. */
  minTokens?: number
  /** Saves the full content; returns an output id for the placeholder. */
  offload?: (content: string) => Promise<string | null>
}

export interface ClearResult {
  entries: TranscriptEntry[]
  cleared: number
  tokensSaved: number
}

function argSummary(entries: TranscriptEntry[], toolCallId: string): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.role !== 'assistant') continue
    const tc = e.toolCalls?.find((c) => c.id === toolCallId)
    if (!tc) continue
    const a = tc.arguments || {}
    const v = a.path ?? a.command ?? a.query ?? a.pattern ?? a.url ?? a.queries
    if (v === undefined) return ''
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return ` ${s.slice(0, 120)}`
  }
  return ''
}

/** Latest working_notes result index — older ones are superseded. */
function latestNotesIndex(entries: TranscriptEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.role === 'tool' && e.name === 'working_notes' && !e.isError) return i
  }
  return -1
}

/**
 * Replace old bulky tool results with short placeholders. Pure except for
 * the optional `offload` callback.
 */
export async function clearOldToolResults(entries: TranscriptEntry[], opts: ClearOptions = {}): Promise<ClearResult> {
  const keepRecent = opts.keepRecent ?? 8
  const keepRecentTokens = opts.keepRecentTokens ?? Infinity
  const minKeep = Math.min(opts.minKeep ?? 3, keepRecent)
  const minChars = opts.minChars ?? 1200
  const targetTokens = opts.targetTokens ?? 20_000
  const minTokens = opts.minTokens ?? 4_000

  const toolIdx: number[] = []
  for (let i = 0; i < entries.length; i++) if (entries[i].role === 'tool') toolIdx.push(i)
  // Protect the newest results: up to keepRecent within the token budget,
  // never fewer than minKeep.
  let protectedFrom = entries.length
  let kept = 0
  let keptTokens = 0
  for (let k = toolIdx.length - 1; k >= 0; k--) {
    const e = entries[toolIdx[k]] as Extract<TranscriptEntry, { role: 'tool' }>
    const cost = estimateCharsAsTokens(typeof e.content === 'string' ? e.content : '')
    if (kept >= minKeep && (kept >= keepRecent || keptTokens + cost > keepRecentTokens)) break
    kept++
    keptTokens += cost
    protectedFrom = toolIdx[k]
  }
  const notesIdx = latestNotesIndex(entries)

  // Candidates, oldest first.
  const candidates: Array<{ index: number; tokens: number; superseded: boolean }> = []
  for (const i of toolIdx) {
    if (i >= protectedFrom) break
    const e = entries[i] as Extract<TranscriptEntry, { role: 'tool' }>
    if (typeof e.content !== 'string' || e.content.startsWith(CLEARED_PREFIX)) continue
    if (extractImageDataUrl(e.content)) continue // screenshots are handled by stripStaleVisionPayloads
    const superseded = e.name === 'working_notes' && i !== notesIdx
    if (!superseded && (CLEAR_EXEMPT.has(e.name) || e.content.length < minChars)) continue
    candidates.push({ index: i, tokens: estimateCharsAsTokens(e.content), superseded })
  }
  const available = candidates.reduce((n, c) => n + c.tokens, 0)
  if (available < minTokens) return { entries, cleared: 0, tokensSaved: 0 }

  const next = entries.slice()
  let saved = 0
  let cleared = 0
  for (const c of candidates) {
    if (saved >= targetTokens) break
    const e = next[c.index] as Extract<TranscriptEntry, { role: 'tool' }>
    let placeholder: string
    if (c.superseded) {
      placeholder = `${CLEARED_PREFIX}: superseded by later working_notes]`
    } else {
      const id = opts.offload ? await opts.offload(e.content).catch(() => null) : null
      const how = id
        ? `full result saved — read_output {"id":"${id}"} (supports grep / offset / tail)`
        : 're-run the tool if you need it again'
      placeholder = `${CLEARED_PREFIX}: ${e.name}${argSummary(next, e.toolCallId)} returned ${e.content.length.toLocaleString('en-US')} chars; ${how}]`
    }
    next[c.index] = { ...e, content: placeholder }
    saved += c.tokens - estimateCharsAsTokens(placeholder)
    cleared++
  }
  return { entries: next, cleared, tokensSaved: Math.max(0, saved) }
}

/** Latest working notes text in a transcript (the result of the last working_notes call). */
export function notesFromTranscript(entries: TranscriptEntry[]): string {
  // Newest wins: a working_notes result, or the block a compaction carried over.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    const text =
      e.role === 'tool' && e.name === 'working_notes' && !e.isError ? e.content : e.role === 'summary' ? e.content : null
    if (text === null) continue
    const m = /<working_notes>\n?([\s\S]*?)\n?<\/working_notes>/.exec(text)
    if (m) return m[1]
    if (e.role === 'tool') return ''
  }
  return ''
}
