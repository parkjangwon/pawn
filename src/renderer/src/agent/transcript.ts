/**
 * Canonical, provider-neutral conversation transcript.
 *
 * Why this exists: prompt caching is a *prefix* match. Every byte the provider
 * sees must be byte-identical to what it saw on the previous turn, or the whole
 * prefix is a miss. The previous implementation rebuilt the request from the
 * display message log — which also contains `role: 'system'` tool-log entries and
 * empty assistant placeholders — so the wire format differed every single turn
 * and the cache never hit once.
 *
 * The transcript below is the single source of truth for what gets sent. It is
 * persisted per session and converted to wire format by a pure, deterministic
 * function, so turn N+1's prefix is exactly turn N's prefix plus an append.
 */

export interface TranscriptToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** An opaque provider-native reasoning block that must be echoed back verbatim. */
export interface TranscriptThinking {
  type: 'thinking' | 'redacted_thinking'
  thinking?: string
  signature?: string
  data?: string
}

export type TranscriptEntry =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: TranscriptToolCall[]; thinking?: TranscriptThinking[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean }
  | { role: 'summary'; content: string }

export const TRANSCRIPT_VERSION = 2

export interface StoredTranscript {
  version: number
 entries: TranscriptEntry[]
 /** Model key (`providerId:modelId`) whose cache the current prefix is warm for. */
 warmFor?: string
  /** Epoch ms of the last API call. Ephemeral cache expires after ~5 min, so a
   *  stale timestamp means the warm prefix is gone and the router must not
   *  assume a cache hit on the next request. */
  lastActivity?: number
}

/** Rough token estimate. Deliberately cheap — only used for compaction thresholds. */
export function estimateTokens(entries: TranscriptEntry[]): number {
  let chars = 0
  for (const e of entries) {
    if (e.role === 'assistant') {
      chars += e.content.length
      for (const tc of e.toolCalls || []) chars += tc.name.length + JSON.stringify(tc.arguments).length
      for (const th of e.thinking || []) chars += (th.thinking || th.data || '').length
    } else {
      chars += e.content.length
    }
  }
  return Math.ceil(chars / 3.6)
}

/**
 * Compaction. Called only when the transcript crosses a threshold, and the
 * result is persisted — so it costs exactly one cache re-prime, not one per turn.
 * A sliding window applied on every request would silently re-prime forever.
 *
 * Strategy: keep the last `keepEntries` entries verbatim, replace everything
 * older with a single summary entry that preserves the user's asks and the
 * files touched. Tool output — by far the bulkiest part — is dropped first.
 */
export function compactTranscript(entries: TranscriptEntry[], keepEntries = 30): TranscriptEntry[] {
  if (entries.length <= keepEntries) return entries

  // Never split an assistant/tool pair: a tool_result with no matching tool_use
  // is a hard API error on both wire formats.
  let cut = entries.length - keepEntries
  while (cut < entries.length && entries[cut].role === 'tool') cut++

  const older = entries.slice(0, cut)
  const recent = entries.slice(cut)

 const asks: string[] = []
 const toolNames = new Map<string, number>()
 const files = new Set<string>()
  const preservedResults: string[] = []
  const MAX_PRESERVED_CHARS = 3000
 for (const e of older) {
   if (e.role === 'user') asks.push(e.content.slice(0, 300))
   if (e.role === 'summary') asks.unshift(e.content)
   if (e.role === 'assistant') {
     for (const tc of e.toolCalls || []) {
       toolNames.set(tc.name, (toolNames.get(tc.name) || 0) + 1)
       const p = tc.arguments.path || tc.arguments.file_path
       if (typeof p === 'string') files.add(p)
     }
   }
    if (e.role === 'tool') {
      // Preserve errors and small outputs so the model retains continuity after
      // compaction. Dropping every tool result (the old behaviour) left the
      // model unable to recall a file it already read or a command it already ran.
      if (e.isError) {
        preservedResults.push(`[${e.name} ERROR] ${e.content.slice(0, 300)}`)
      } else if (e.content.length <= 500) {
        preservedResults.push(`[${e.name}] ${e.content}`)
      } else if (e.name === 'read_file' || e.name === 'list_dir' || e.name === 'grep_search' || e.name === 'search_files') {
        preservedResults.push(`[${e.name}] ${e.content.slice(0, 200)}...`)
      }
    }
 }

  const parts = ['--- Earlier conversation (compacted) ---']
  if (asks.length) parts.push('User asked:\n' + asks.map((a) => `- ${a}`).join('\n'))
  if (toolNames.size) {
    parts.push('Tools used: ' + Array.from(toolNames.entries()).map(([n, c]) => `${n}x${c}`).join(', '))
  }
 if (files.size) parts.push('Files touched:\n' + Array.from(files).slice(0, 40).map((f) => `- ${f}`).join('\n'))
  // Cap preserved results so the summary doesn't balloon past the point of being
  // cheaper than keeping the raw entries.
  let usedChars = 0
  const keptResults: string[] = []
  for (const r of preservedResults) {
    if (usedChars + r.length > MAX_PRESERVED_CHARS) break
    keptResults.push(r)
    usedChars += r.length
  }
  if (keptResults.length > 0) {
    parts.push('Key results from earlier:\n' + keptResults.map((r) => `- ${r}`).join('\n'))
  }
 parts.push('Re-read any file above before editing it; its contents are no longer in context.')

  return [{ role: 'summary', content: parts.join('\n\n') }, ...recent]
}

// --- Wire format conversion -------------------------------------------------
// Both converters must be pure and deterministic: same entries in, byte-identical
// JSON out. No timestamps, no Map iteration over non-insertion-ordered data, no
// `undefined` keys that serialize differently between runs.

export function toClaudeMessages(entries: TranscriptEntry[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []

  for (const e of entries) {
    // User content is always emitted as a block array, never a bare string.
    // A cache anchor has to attach `cache_control` to a block, and a message
    // whose shape flips between turns would change the serialized prefix.
    if (e.role === 'user' || e.role === 'summary') {
      out.push({ role: 'user', content: [{ type: 'text', text: e.content }] })
      continue
    }
    if (e.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = []
      // Thinking blocks must come first and be echoed verbatim, signature
      // included — Anthropic rejects a tool-use turn whose reasoning was stripped.
      for (const th of e.thinking || []) {
        if (th.type === 'redacted_thinking') blocks.push({ type: 'redacted_thinking', data: th.data || '' })
        else blocks.push({ type: 'thinking', thinking: th.thinking || '', signature: th.signature || '' })
      }
      if (e.content) blocks.push({ type: 'text', text: e.content })
      for (const tc of e.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
      }
      if (blocks.length === 0) continue
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    // Tool results: consecutive results must be merged into ONE user message,
    // otherwise a parallel tool call round produces N user turns and the model
    // sees a malformed conversation.
    const block = {
      type: 'tool_result',
      tool_use_id: e.toolCallId,
      content: e.content,
      is_error: e.isError === true
    }
    const prev = out[out.length - 1]
    if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
      (prev.content as Array<Record<string, unknown>>).push(block)
    } else {
      out.push({ role: 'user', content: [block] })
    }
  }

  return out
}

export function toOpenAIMessages(entries: TranscriptEntry[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []

  for (const e of entries) {
    if (e.role === 'user' || e.role === 'summary') {
      out.push({ role: 'user', content: e.content })
      continue
    }
    if (e.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: e.content || null }
      if (e.toolCalls && e.toolCalls.length > 0) {
        msg.tool_calls = e.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      } else if (!e.content) {
        continue
      }
      out.push(msg)
      continue
    }
    out.push({ role: 'tool', tool_call_id: e.toolCallId, content: e.content })
  }

  return out
}

/**
 * Drop any trailing entries that would make the request invalid — an assistant
 * turn with tool calls whose results never arrived (agent aborted mid-round).
 * Runs before send, on a copy; the stored transcript keeps the full record.
 */
export function sanitizeForSend(entries: TranscriptEntry[]): TranscriptEntry[] {
  const out = entries.slice()

  // Every tool_use needs a matching tool_result. Walk backwards and trim any
  // assistant tool-call turn left unanswered at the tail.
  for (;;) {
    const lastAssistant = out.map((e) => e.role).lastIndexOf('assistant')
    if (lastAssistant === -1) break
    const entry = out[lastAssistant] as Extract<TranscriptEntry, { role: 'assistant' }>
    const calls = entry.toolCalls || []
    if (calls.length === 0) break
    const answered = new Set(
      out.slice(lastAssistant + 1).filter((e): e is Extract<TranscriptEntry, { role: 'tool' }> => e.role === 'tool')
        .map((e) => e.toolCallId)
    )
    if (calls.every((c) => answered.has(c.id))) break
    out.splice(lastAssistant)
  }

  return out
}
