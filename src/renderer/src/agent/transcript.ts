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

import type { ModelTier } from '../types/provider'

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
  | { role: 'user'; content: string; attachments?: TranscriptImageAttachment[] }
  | {
      role: 'assistant'
      content: string
      toolCalls?: TranscriptToolCall[]
      thinking?: TranscriptThinking[]
      /**
       * OpenAI-compat reasoning field (DeepSeek thinking mode, etc.).
       * Must be echoed on subsequent tool-loop requests or the API returns 400.
       */
      reasoningContent?: string
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean }
  | { role: 'summary'; content: string }

/** @deprecated use needsReasoningContentEcho from deepseekCompat */
export { needsReasoningContentEcho as modelNeedsReasoningContentEcho } from './deepseekCompat'

/** User-attached images, sent as real vision blocks on both wire formats. */
export interface TranscriptImageAttachment {
  kind: 'image'
  dataUrl: string
  name?: string
}

/** Extract a data-URL image from tool content (optionally preceded by text meta). */
export function extractImageDataUrl(content: string): string | null {
  if (!content) return null
  if (content.startsWith('data:image/')) {
    const m = content.match(/^data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=\s]+/)
    return m ? m[0].replace(/\s+/g, '') : content.split(/\s/)[0] || null
  }
  const m = content.match(/data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/)
  return m ? m[0] : null
}

/**
 * True when the *current turn* needs a vision-capable model.
 * Only the last user message and entries after it count — older computer_screenshot
 * / attachment images must not force vision routing forever (text follow-ups stay on
 * the text model + vision fallback only when new images appear).
 */
export function transcriptNeedsVision(entries: TranscriptEntry[]): boolean {
  let lastUserIdx = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }
  const start = lastUserIdx >= 0 ? lastUserIdx : 0
  for (let i = start; i < entries.length; i++) {
    const e = entries[i]
    if (e.role === 'user' && e.attachments?.some((a) => a.kind === 'image' && !!a.dataUrl)) {
      return true
    }
    if (e.role === 'tool' && typeof e.content === 'string' && extractImageDataUrl(e.content)) {
      return true
    }
  }
  return false
}

/**
 * Drop full data-URL screenshots from tool results that predate the last user
 * message, so old computer-use frames do not bloat the request or force vision.
 * Keeps a short text stub (and any meta lines) for continuity.
 */
export function stripStaleVisionPayloads(entries: TranscriptEntry[]): TranscriptEntry[] {
  let lastUserIdx = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx < 0) return entries

  return entries.map((e, i) => {
    if (e.role !== 'tool' || i >= lastUserIdx) return e
    if (typeof e.content !== 'string') return e
    const url = extractImageDataUrl(e.content)
    if (!url) return e
    const meta = e.content.replace(url, '').replace(/\n+/g, ' ').trim()
    return {
      ...e,
      content: meta
        ? `${meta}\n[earlier screenshot omitted from context]`
        : '[earlier screenshot omitted from context]'
    }
  })
}

/** Fixed token cost for one vision image (base64 length is not real tokens). */
const IMAGE_TOKEN_ESTIMATE = 1_200

export const TRANSCRIPT_VERSION = 2

export interface StoredTranscript {
  version: number
 entries: TranscriptEntry[]
  /** Model key (`providerId:modelId`) whose cache the current prefix is warm for. */
  warmFor?: string
  /** Tier of the warm model, so a resumed session can restore the sticky route. */
  warmTier?: ModelTier
  /** Epoch ms of the last API call. Ephemeral cache expires after ~5 min, so a
   *  stale timestamp means the warm prefix is gone and the router must not
   *  assume a cache hit on the next request. */
  lastActivity?: number
}

/**
 * Char → token estimate that accounts for CJK density.
 * Latin ≈ 4 chars/token; CJK ≈ 1.5–2 chars/token. Blended by script share.
 */
export function estimateCharsAsTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    // CJK Unified + Hangul + Hiragana/Katakana + fullwidth forms
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0xff00 && c <= 0xffef)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk / 1.7 + other / 4)
}

/** Rough token estimate for compaction thresholds and the context meter. */
export function estimateTokens(entries: TranscriptEntry[]): number {
  let tokens = 0
  let imageTokens = 0
  for (const e of entries) {
    if (e.role === 'assistant') {
      tokens += estimateCharsAsTokens(e.content)
      for (const tc of e.toolCalls || []) {
        tokens += estimateCharsAsTokens(tc.name + JSON.stringify(tc.arguments || {}))
      }
      for (const th of e.thinking || []) {
        tokens += estimateCharsAsTokens(th.thinking || th.data || '')
      }
      if (e.reasoningContent) tokens += estimateCharsAsTokens(e.reasoningContent)
    } else if (e.role === 'tool') {
      const url = typeof e.content === 'string' ? extractImageDataUrl(e.content) : null
      if (url) {
        imageTokens += IMAGE_TOKEN_ESTIMATE
        tokens += estimateCharsAsTokens(
          e.content.length > url.length ? e.content.slice(0, e.content.indexOf(url)) : ''
        )
      } else {
        tokens += estimateCharsAsTokens(e.content)
      }
    } else {
      tokens += estimateCharsAsTokens(e.content)
      if (e.role === 'user') {
        for (const a of e.attachments || []) {
          if (a.dataUrl?.startsWith('data:image/')) imageTokens += IMAGE_TOKEN_ESTIMATE
          else tokens += estimateCharsAsTokens(a.dataUrl || '')
        }
      }
    }
  }
  // Per-message overhead (role tags, separators) — small but real.
  tokens += entries.length * 4
  return tokens + imageTokens
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
  const conclusions: string[] = []
  const toolNames = new Map<string, number>()
  const files = new Set<string>()
  const decisions: string[] = []
  const preservedResults: string[] = []
  const MAX_PRESERVED_CHARS = 4500
  for (const e of older) {
    if (e.role === 'user') asks.push(e.content.slice(0, 400))
    if (e.role === 'summary') asks.unshift(e.content)
    if (e.role === 'assistant') {
      // Keep short final answers / conclusions (not tool-call scaffolding).
      const text = (e.content || '').trim()
      if (text && !e.toolCalls?.length) {
        conclusions.push(text.slice(0, 500))
      } else if (text.length > 80 && text.length < 1200) {
        conclusions.push(text.slice(0, 400))
      }
      for (const tc of e.toolCalls || []) {
        toolNames.set(tc.name, (toolNames.get(tc.name) || 0) + 1)
        const p = tc.arguments.path || tc.arguments.file_path || tc.arguments.cwd
        if (typeof p === 'string') files.add(p)
        if (tc.name === 'edit_file' || tc.name === 'write_file' || tc.name === 'git_commit') {
          decisions.push(`${tc.name}${typeof p === 'string' ? ` → ${p}` : ''}`)
        }
      }
    }
    if (e.role === 'tool') {
      if (e.isError) {
        preservedResults.push(`[${e.name} ERROR] ${e.content.slice(0, 400)}`)
      } else if (e.content.length <= 600) {
        preservedResults.push(`[${e.name}] ${e.content}`)
      } else if (
        e.name === 'read_file' ||
        e.name === 'list_dir' ||
        e.name === 'grep_search' ||
        e.name === 'search_files' ||
        e.name === 'git_status' ||
        e.name === 'git_diff' ||
        e.name === 'run_checks'
      ) {
        preservedResults.push(`[${e.name}] ${e.content.slice(0, 280)}...`)
      }
    }
  }

  const parts = ['--- Earlier conversation (compacted) ---']
  if (asks.length) {
    parts.push(
      'User asked:\n' +
        asks
          .slice(-12)
          .map((a) => `- ${a}`)
          .join('\n')
    )
  }
  if (conclusions.length) {
    parts.push(
      'Assistant conclusions (earlier):\n' +
        conclusions
          .slice(-8)
          .map((c) => `- ${c.replace(/\n+/g, ' ')}`)
          .join('\n')
    )
  }
  if (decisions.length) {
    parts.push(
      'Key actions:\n' +
        [...new Set(decisions)]
          .slice(0, 24)
          .map((d) => `- ${d}`)
          .join('\n')
    )
  }
  if (toolNames.size) {
    parts.push(
      'Tools used: ' +
        Array.from(toolNames.entries())
          .map(([n, c]) => `${n}×${c}`)
          .join(', ')
    )
  }
  if (files.size) {
    parts.push(
      'Files touched:\n' +
        Array.from(files)
          .slice(0, 50)
          .map((f) => `- ${f}`)
          .join('\n')
    )
  }
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
  parts.push(
    'Re-read any file above before editing it; full contents are no longer in context. Prefer git_status/git_diff if unsure what landed.'
  )

  return [{ role: 'summary', content: parts.join('\n\n') }, ...recent]
}

// --- Wire format conversion -------------------------------------------------
// Both converters must be pure and deterministic: same entries in, byte-identical
// JSON out. No timestamps, no Map iteration over non-insertion-ordered data, no
// `undefined` keys that serialize differently between runs.

export function toClaudeMessages(entries: TranscriptEntry[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []

  for (const e of entries) {
    if (e.role === 'user' || e.role === 'summary') {
      const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: e.content }]
      if (e.role === 'user') {
        for (const a of e.attachments || []) {
          const match = a.dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/)
          if (!match) continue
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: match[1], data: match[2] }
          })
        }
      }
      out.push({ role: 'user', content: blocks })
      continue
    }
    if (e.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = []
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

    const dataUrl = typeof e.content === 'string' ? extractImageDataUrl(e.content) : null
    let blockContent: unknown = e.content
    if (dataUrl) {
      const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/)
      const meta = e.content
        .replace(dataUrl, '')
        .replace(/\n+/g, ' ')
        .trim()
      if (match) {
        const blocks: Array<Record<string, unknown>> = []
        if (meta) blocks.push({ type: 'text', text: meta })
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2]
          }
        })
        blockContent = blocks
      }
    }

    const block = {
      type: 'tool_result',
      tool_use_id: e.toolCallId,
      content: blockContent,
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

export function toOpenAIMessages(
  entries: TranscriptEntry[],
  opts?: { echoReasoningContent?: boolean }
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const echoReasoning = opts?.echoReasoningContent === true

  for (const e of entries) {
    if (e.role === 'user' || e.role === 'summary') {
      const images = e.role === 'user' ? (e.attachments || []).filter((a) => a.dataUrl.startsWith('data:image/')) : []
      if (images.length > 0) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: e.content },
            ...images.map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } }))
          ]
        })
      } else {
        out.push({ role: 'user', content: e.content })
      }
      continue
    }
    if (e.role === 'assistant') {
      const msg: Record<string, unknown> = {
        role: 'assistant',
        // DeepSeek accepts null content when tool_calls are present.
        content: e.content || null
      }
      if (e.toolCalls && e.toolCalls.length > 0) {
        msg.tool_calls = e.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      } else if (!e.content && !e.reasoningContent) {
        continue
      }
      // DeepSeek thinking + tools (api-docs.deepseek.com/guides/thinking_mode):
      // When the request carries `tools`, assistant messages that used tools must
      // pass reasoning_content back on every subsequent request (even "").
      // Pure multi-turn finals without tool_calls may omit CoT (API ignores if sent).
      if (echoReasoning) {
        if (e.toolCalls && e.toolCalls.length > 0) {
          msg.reasoning_content = e.reasoningContent ?? ''
        } else if (e.reasoningContent != null && e.reasoningContent !== '') {
          // Keep CoT from tool-loop final answers for multi-turn continuity (sample Turn 1.3→2).
          msg.reasoning_content = e.reasoningContent
        }
      }
      out.push(msg)
      continue
    }
    
    const dataUrl = typeof e.content === 'string' ? extractImageDataUrl(e.content) : null
    if (dataUrl) {
      const meta = e.content.replace(dataUrl, '').replace(/\n+/g, ' ').trim()
      out.push({
        role: 'tool',
        tool_call_id: e.toolCallId,
        content: meta || 'Screenshot captured and attached. Coords use image space (top-left).'
      })
      out.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl }
          }
        ]
      })
    } else {
      out.push({ role: 'tool', tool_call_id: e.toolCallId, content: e.content })
    }
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
