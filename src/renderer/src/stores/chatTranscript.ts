import { useAppStore } from './app'
import { useProviderStore } from './provider'
import { useUsageStore } from './usage'
import { clearSessionRoute, setSessionRoute, type Complexity } from '../agent/router'
import {
  extractImageDataUrl, estimateTokens, TRANSCRIPT_VERSION,
  type TranscriptEntry, type StoredTranscript
} from '../agent/transcript'
import { saveTurnCheckpoint } from './turnCheckpoint'
import { enqueueDbWrite } from '../utils/dbWriteQueue'
import { stripDisplayImages, type ChatAttachment } from '../utils/attachments'
import type { ModelTier } from '../types/provider'
import type { ToolCall } from '../agent/tools'
import i18n from '../i18n'

/** Anthropic ephemeral cache TTL is ~5 min. After that the warm prefix is gone
 *  and the router must not assume a cache hit on the resumed session. */
const CACHE_STALE_MS = 5 * 60 * 1000

// --- Transcript persistence -------------------------------------------------

export function currentMessageContent(projectId: string, sessionId: string, messageId: string): string {
  const msg = useAppStore.getState().projects
    .find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
    ?.messages.find((m) => m.id === messageId)
  return msg?.content ?? ''
}

export function systemError(projectId: string, sessionId: string, text: string): void {
  useAppStore.getState().addMessage(projectId, sessionId, {
    id: `${Date.now()}-err-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: text,
    createdAt: Date.now()
  })
}

export async function loadTranscript(projectId: string, sessionId: string): Promise<TranscriptEntry[]> {
  try {
    const raw = await window.api.db.getTranscript(sessionId)
    if (raw) {
     const parsed = JSON.parse(raw) as StoredTranscript
     if (parsed && Array.isArray(parsed.entries) && parsed.version === TRANSCRIPT_VERSION) {
        // Cold start: if the last API call was more than CACHE_STALE_MS ago, the
        // ephemeral cache prefix is gone. Clear the sticky route so the router
        // doesn't assume a warm prefix and misjudge downgrade economics.
       if (parsed.lastActivity && Date.now() - parsed.lastActivity > CACHE_STALE_MS) {
         clearSessionRoute(sessionId)
          useUsageStore.getState().noteDiagnostic(sessionId, 'warn', i18n.t('chat.diagnostics.coldStart'))
       } else if (parsed.warmFor) {
         // Resume the sticky route so the first call of a resumed session reuses
         // the still-live ephemeral cache instead of paying a re-prime.
         const warmModel = useProviderStore.getState().models.find(
           (m) => `${m.providerId}:${m.modelId}` === parsed.warmFor
         )
         if (warmModel) {
           setSessionRoute(sessionId, parsed.warmFor, parsed.warmTier || warmModel.tier, estimateTokens(parsed.entries))
         }
       }
       return parsed.entries
     }
    }
  } catch {
    // Corrupt or absent — fall through to reconstruction.
  }

  // First run on an existing session (or after a schema bump): rebuild a plain
  // user/assistant transcript from the visible history. Tool-log entries are
  // display-only and are deliberately dropped.
  await useAppStore.getState().loadMessages(projectId, sessionId)
  const session = useAppStore.getState().projects
    .find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
  const entries: TranscriptEntry[] = []
  for (const m of session?.messages || []) {
    if (m.role === 'system') continue
    if (!m.content.trim()) continue
    if (m.role === 'user') {
      const text = stripDisplayImages(m.content)
      if (text) entries.push({ role: 'user', content: text })
    }
    else entries.push({ role: 'assistant', content: m.content })
  }
  // The bubble for the message being sent right now is already in the store;
  // the caller appends it explicitly, so drop the duplicate tail.
  if (entries.length > 0 && entries[entries.length - 1].role === 'user') entries.pop()
  return entries
}

export function persistTranscript(sessionId: string, entries: TranscriptEntry[], warmFor: string, warmTier?: ModelTier): void {
  const payload: StoredTranscript = { version: TRANSCRIPT_VERSION, entries, warmFor, warmTier, lastActivity: Date.now() }
  enqueueDbWrite(`transcript:${sessionId}`, () =>
    window.api.db.saveTranscript(sessionId, JSON.stringify(payload))
  )
}

export function checkpointSnapshot(opts: {
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
  userMessageAppended: boolean
}): void {
  saveTurnCheckpoint({
    version: 1,
    projectId: opts.projectId,
    sessionId: opts.sessionId,
    userContent: opts.userContent,
    attachments: opts.attachments,
    entries: opts.entries,
    round: opts.round,
    consecutiveToolErrors: opts.consecutiveToolErrors,
    emptyResponses: opts.emptyResponses,
    complexity: opts.complexity,
    turnHadCodeEdits: opts.turnHadCodeEdits,
    turnRanChecks: opts.turnRanChecks,
    autoVerifyDone: opts.autoVerifyDone,
    warmFor: opts.warmFor,
    warmTier: opts.warmTier,
    userMessageAppended: opts.userMessageAppended,
    lastActivity: Date.now()
  })
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Order- and key-order-independent fingerprint of a round's tool calls. */
export function toolCallSignature(calls: ToolCall[]): string {
  return calls
    .map((c) => `${c.name}:${stableStringify(c.arguments)}`)
    .sort()
    .join('|')
}

/** Counts consecutive rounds whose tool calls are identical (a loop signal). */
export class ToolLoopCounter {
  private signature: string | null = null
  private repeats = 0

  constructor(private readonly limit: number) {}

  /** Returns true once the same tool-call set has repeated `limit` consecutive rounds. */
  record(calls: ToolCall[]): boolean {
    const sig = calls.length > 0 ? toolCallSignature(calls) : null
    if (sig === null) {
      this.signature = null
      this.repeats = 0
      return false
    }
    this.repeats = sig === this.signature ? this.repeats + 1 : 1
    this.signature = sig
    return this.repeats >= this.limit
  }
}

/** Per-tool transcript budgets. UI still truncates display separately (formatToolMessageContent). */
const TOOL_RESULT_CAPS: Record<string, number> = {
  read_file: 80_000,
  grep_search: 24_000,
  search_files: 16_000,
  git_diff: 40_000,
  git_status: 8_000,
  shell_exec: 24_000,
  list_dir: 12_000,
  write_file: 4_000,
  edit_file: 4_000,
  load_skill: 40_000
}
const DEFAULT_TOOL_RESULT_CAP = 12_000

/** Replace image data-URLs with short text so a text-only model can continue. */
export function demoteVisionPayloadsToText(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((e) => {
    if (e.role === 'tool' && typeof e.content === 'string') {
      const url = extractImageDataUrl(e.content)
      if (!url) return e
      const meta = e.content.replace(url, '').replace(/\n+/g, ' ').trim()
      return {
        ...e,
        content: meta
          ? `${meta}\n[screenshot image omitted — no vision model; describe UI from context or retry after setting Vision fallback]`
          : '[screenshot image omitted — no vision model; set Vision fallback in Settings → Agent]'
      }
    }
    if (e.role === 'user' && e.attachments?.length) {
      const { attachments: _a, ...rest } = e
      return {
        ...rest,
        content:
          (e.content || '') +
          '\n[user image attachment omitted — no vision model available]'
      }
    }
    return e
  })
}

/** Cap tool payloads fed back into the transcript / LLM. */
export function truncateToolResult(
  result: { content: string; name?: string },
  toolNameOrMax?: string | number,
  maybeMax?: number
): string {
  // Screenshots are data URLs (optionally with meta lines before the data: URL).
  // Never truncate — corruption makes vision fail and bloated base64 breaks routing.
  if (typeof result.content === 'string') {
    const c = result.content
    if (c.startsWith('data:image/') || extractImageDataUrl(c)) {
      return c
    }
  }
  let toolName = result.name
  let maxLen = DEFAULT_TOOL_RESULT_CAP
  if (typeof toolNameOrMax === 'number') {
    maxLen = toolNameOrMax
  } else if (typeof toolNameOrMax === 'string') {
    toolName = toolNameOrMax
    maxLen = maybeMax ?? (toolName ? TOOL_RESULT_CAPS[toolName] ?? DEFAULT_TOOL_RESULT_CAP : DEFAULT_TOOL_RESULT_CAP)
  } else if (toolName) {
    maxLen = TOOL_RESULT_CAPS[toolName] ?? DEFAULT_TOOL_RESULT_CAP
  }
  if (result.content.length <= maxLen) return result.content
  const omitted = result.content.length - maxLen
  // Preserve both head (initial context) and tail (error stack / summary ending)
  const headLen = Math.floor(maxLen * 0.65)
  const tailLen = Math.max(0, maxLen - headLen)
  const head = result.content.slice(0, headLen)
  const tail = tailLen > 0 ? result.content.slice(result.content.length - tailLen) : ''
  return (
    `${head}\n\n...(truncated ${omitted} chars — re-read with offset/limit or narrow the search)\n\n${tail}`
  )
}

