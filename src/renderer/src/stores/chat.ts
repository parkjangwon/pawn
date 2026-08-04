import { create } from 'zustand'
import { useAppStore } from './app'
import { useProviderStore } from './provider'
import { useUsageStore, type CallUsage } from './usage'
import { executeTool, TOOL_SAFETY, type ToolCall, type ToolResult } from '../agent/tools'
import { loadProjectContext, buildProjectContextBlock } from '../agent/skills'
import {
  route, estimateComplexity, shouldEscalate, routeKey, setSessionRoute, clearSessionRoute,
  noteProviderFailure, noteProviderSuccess, refreshMeasuredPricing,
  type RouteDecision
} from '../agent/router'
import { compactTranscript, estimateTokens, TRANSCRIPT_VERSION, type TranscriptEntry, type StoredTranscript } from '../agent/transcript'
import { formatToolMessageContent } from '../agent/toolMessage'
import { callLLM, type LlmResult } from '../agent/llm'
import { SYSTEM_PROMPT } from '../agent/prompts'
import type { ModelTier } from '../types/provider'
import { filterEnabledSkills } from '../utils/skillVisibility'
import { buildDisplayContent, buildTranscriptText, imageAttachments, stripDisplayImages, type ChatAttachment } from '../utils/attachments'
import i18n from '../i18n'

export type SendMode = 'queue' | 'steer'

/** Hard ceiling on LLM rounds per user message; runaway agents die here. */
const MAX_TOOL_ROUNDS = 50
/** Consecutive identical tool-call sets before we call it a loop and stop. */
const MAX_REPEATED_TOOL_ROUNDS = 3
/** Model attempts per round before the turn gives up (each on a different model). */
const MAX_ROUTE_ATTEMPTS = 3
/** Compact once the replayed transcript passes this share of the model's context. */
const COMPACT_AT_RATIO = 0.6
const DEFAULT_CONTEXT_WINDOW = 128_000
/** Anthropic ephemeral cache TTL is ~5 min. After that the warm prefix is gone
 *  and the router must not assume a cache hit on the resumed session. */
const CACHE_STALE_MS = 5 * 60 * 1000

interface QueueItem {
  projectId: string
  sessionId: string
  content: string
  attachments?: ChatAttachment[]
  /** The bubble is already on screen from when the message was queued. */
  displayed: boolean
}

interface ChatState {
  isStreaming: boolean
  /** Session currently producing tokens; lets the UI mark it as running. */
  streamingSessionId: string | null
  queue: QueueItem[]
  sendMessage: (projectId: string, sessionId: string, content: string, mode: SendMode, attachments?: ChatAttachment[]) => void
  stopStreaming: () => void
}

let abortController: AbortController | null = null



export const useChatStore = create<ChatState>((set, get) => ({
  isStreaming: false,
  streamingSessionId: null,
  queue: [],

  sendMessage: (projectId, sessionId, content, mode, attachments) => {
    const state = get()

    // Refresh measured pricing from recent usage (throttled inside the router)
    // so auto routing tracks real provider rates instead of stale snapshots.
    void refreshMeasuredPricing()

    if (mode === 'queue' && state.isStreaming) {
      set({ queue: [...state.queue, { projectId, sessionId, content, attachments, displayed: true }] })
      pushUserBubble(projectId, sessionId, content, attachments)
      return
    }

    if (mode === 'steer' && state.isStreaming) {
      abortController?.abort()
    }

    pushUserBubble(projectId, sessionId, content, attachments)
    autoTitle(projectId, sessionId, content)

    set({ isStreaming: true, streamingSessionId: sessionId })
    window.api.setStreaming?.(true)
    void agentLoop(projectId, sessionId, content, set, get, attachments)
  },

  stopStreaming: () => {
    abortController?.abort()
    set({ isStreaming: false, streamingSessionId: null })
    window.api.setStreaming?.(false)
  }
}))

function pushUserBubble(projectId: string, sessionId: string, content: string, attachments?: ChatAttachment[]): void {
  useAppStore.getState().addMessage(projectId, sessionId, {
    id: `${Date.now()}-user-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: buildDisplayContent(content, attachments),
    createdAt: Date.now()
  })
}

function autoTitle(projectId: string, sessionId: string, content: string): void {
  const session = useAppStore.getState().projects
    .find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
  if (session && session.messages.length <= 1 && session.title === 'New Session') {
    useAppStore.getState().updateSessionTitle(
      projectId, sessionId,
      content.slice(0, 40) + (content.length > 40 ? '...' : '')
    )
  }
}

function currentMessageContent(projectId: string, sessionId: string, messageId: string): string {
  const msg = useAppStore.getState().projects
    .find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
    ?.messages.find((m) => m.id === messageId)
  return msg?.content ?? ''
}

function systemError(projectId: string, sessionId: string, text: string): void {
  useAppStore.getState().addMessage(projectId, sessionId, {
    id: `${Date.now()}-err-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: text,
    createdAt: Date.now()
  })
}

// --- Transcript persistence -------------------------------------------------

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

function persistTranscript(sessionId: string, entries: TranscriptEntry[], warmFor: string, warmTier?: ModelTier): void {
  const payload: StoredTranscript = { version: TRANSCRIPT_VERSION, entries, warmFor, warmTier, lastActivity: Date.now() }
  window.api.db.saveTranscript(sessionId, JSON.stringify(payload)).catch(() => {
    // Losing a transcript write costs a cache re-prime, never correctness.
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

// --- Agent loop -------------------------------------------------------------

async function agentLoop(
  projectId: string,
  sessionId: string,
  userContent: string,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
  attachments?: ChatAttachment[]
): Promise<void> {
  // A live loop owns the turn; only an aborted one may be replaced. This makes
  // concurrent agent loops impossible even if two send paths race.
  if (abortController && !abortController.signal.aborted) return

  const { providers, models } = useProviderStore.getState()
  if (providers.filter((p) => p.enabled).length === 0 || models.filter((m) => m.enabled).length === 0) {
    systemError(projectId, sessionId, i18n.t('chat.errors.noProvider'))
    set(() => ({ isStreaming: false, streamingSessionId: null }))
    window.api.setStreaming?.(false)
    processQueue(set, get)
    return
  }

  // Each loop owns its controller. `abortController` points at the newest loop
  // so Stop/steer always abort the live one; the finally below only clears the
  // reference if this loop is still the newest (a stale loop must never
  // clobber the controller or the streaming flags of its replacement).
  const controller = new AbortController()
  abortController = controller
  const signal = controller.signal

  try {
    const project = useAppStore.getState().projects.find((p) => p.id === projectId)
    const projectPath = project?.paths?.[0]
    const session = project?.sessions.find((s) => s.id === sessionId)
    const cwd = session?.path || projectPath || ''

    // System prompt as ordered layers. Caching is a prefix match, so the most
    // stable content comes first and per-turn content only ever appends at the
    // tail of `messages` — never into the system block.
   //   layer 0: base prompt        — identical everywhere, shared cache
    //   preamble : cwd + project ctx — injected into messages, not the system block,
    //   so the system cache prefix is shared across all projects and sessions.
   const systemLayers: string[] = [SYSTEM_PROMPT]
    let projectPreamble = ''
   if (cwd) {
      projectPreamble += `--- Working Directory ---\n${cwd}\nResolve relative paths against this directory unless told otherwise.`
   }
   if (projectPath) {
     try {
       const ctx = await loadProjectContext(projectPath)
       const block = buildProjectContextBlock({ ...ctx, skills: filterEnabledSkills(ctx.skills) })
        if (block) projectPreamble += (projectPreamble ? '\n\n' : '') + block
     } catch {
       // Missing CLAUDE.md / skills is normal; keep the base layer.
     }
   }
    // systemLayers stays [SYSTEM_PROMPT] only — project context is passed as
    // preamble to callLLM, where it is injected into the messages array.

   let entries = await loadTranscript(projectId, sessionId)
    const imgs = imageAttachments(attachments)
    entries.push({
      role: 'user',
      content: buildTranscriptText(userContent, attachments),
      ...(imgs.length > 0 ? { attachments: imgs } : {})
    })

    const complexity = estimateComplexity(userContent)
    let consecutiveToolErrors = 0
    let emptyResponses = 0
    let round = 0
    let lastDecision: RouteDecision | null = null
    const loopCounter = new ToolLoopCounter(MAX_REPEATED_TOOL_ROUNDS)

    while (round < MAX_TOOL_ROUNDS) {
      if (signal.aborted) break
      round++

      // Compaction runs at a threshold and the result is persisted, so it costs
      // exactly one cache re-prime — unlike a sliding window, which would silently
      // re-prime on every single request.
      const contextWindow = lastDecision?.model.contextWindow || DEFAULT_CONTEXT_WINDOW
     if (estimateTokens(entries) > contextWindow * COMPACT_AT_RATIO) {
       entries = compactTranscript(entries)
       persistTranscript(sessionId, entries, lastDecision?.key || '', lastDecision?.tier)
        useUsageStore.getState().noteDiagnostic(sessionId, 'info', i18n.t('chat.diagnostics.compacted'))
     }

      const escalate = shouldEscalate({ consecutiveToolErrors, round, emptyResponses })
      const excluded = new Set<string>()
      let transientFailures = 0
      let result: LlmResult | null = null
      let decision: RouteDecision | null = null

      // Try up to MAX_ROUTE_ATTEMPTS distinct models before failing the turn.
      for (let attempt = 0; attempt < MAX_ROUTE_ATTEMPTS; attempt++) {
        if (signal.aborted) break
        decision = route({
          sessionId,
          entries,
          complexity,
          // After two transient failures in a row, try a stronger tier instead
          // of retrying the same tier a third time.
          escalate: escalate + (transientFailures >= 2 ? 1 : 0),
          exclude: excluded,
          newTurn: round === 1
        })
        if (!decision) break

        // Surface why the router picked this model (escalation, fallback,
        // downgrade, context limits) in the usage diagnostics panel.
        if (/escalat|fell back|downgrade|context too small/.test(decision.reason)) {
          useUsageStore.getState().noteDiagnostic(
            sessionId,
            'info',
            i18n.t('chat.diagnostics.routing', {
              model: decision.model.label || decision.model.modelId,
              reason: decision.reason
            })
          )
        }

        const assistantMsgId = `${Date.now()}-assistant-${round}-${attempt}`
        useAppStore.getState().addMessage(projectId, sessionId, {
          id: assistantMsgId, role: 'assistant', content: '', createdAt: Date.now()
        })

        try {
         result = await callLLM({
            decision, entries, systemLayers, projectPreamble, sessionId, projectId, projectPath, assistantMsgId, signal
         })
          noteProviderSuccess(decision.provider.id)
          setSessionRoute(sessionId, decision.key, decision.tier, estimateTokens(entries))
          useUsageStore.getState().noteRoute(
            sessionId,
            decision.model.label || decision.model.modelId,
            decision.reason
          )
          useUsageStore.getState().record(sessionId, decision.model, result.usage)

          // Tag the message bubble with the model that produced it so the UI
          // can show "answered by <model>" in auto mode.
          const { routingMode } = useProviderStore.getState()
          if (routingMode === 'auto' && currentMessageContent(projectId, sessionId, assistantMsgId).trim()) {
            useAppStore.getState().updateMessageModel(
              projectId, sessionId, assistantMsgId,
              decision.model.label || decision.model.modelId
            )
          }

          // Drop the placeholder only if NOTHING was ever shown for it — an
          // empty bubble next to a tool card is just noise. Check what was
          // actually displayed, not result.text alone: a reasoning model can
          // stream substantial "thinking" while result.text (the replayable
          // final answer) stays empty, and that thinking must not vanish.
          if (!currentMessageContent(projectId, sessionId, assistantMsgId).trim()) {
            useAppStore.getState().removeMessage(projectId, sessionId, assistantMsgId)
          }
          lastDecision = decision
          break
        } catch (err) {
          // The message may already hold real, useful text streamed before the
          // failure (a dropped connection mid-stream, or the user hitting Stop).
          // Deleting it unconditionally threw away content the user had already
          // read on screen. Only discard a truly empty placeholder outright.
          const streamed = currentMessageContent(projectId, sessionId, assistantMsgId)
          if (signal.aborted) {
            // Stop is terminal — there is no retry to deduplicate against, so
            // whatever was streamed becomes the final answer for this round.
            if (!streamed.trim()) useAppStore.getState().removeMessage(projectId, sessionId, assistantMsgId)
            throw err
          }
          // A genuine failure retries on a different model in the next attempt,
          // which creates its own fresh bubble — keeping this attempt's partial
          // text around would leave a confusing duplicate next to the retry.
          useAppStore.getState().removeMessage(projectId, sessionId, assistantMsgId)
          const message = err instanceof Error ? err.message : String(err)
          // Only transient failures (network, 429, 5xx, overloaded) cool the
          // provider down; a bad key or unknown model is permanent and should
          // not punish the provider's other models.
          if ((err as { transient?: boolean }).transient !== false) {
            transientFailures++
            noteProviderFailure(decision.provider.id)
          } else {
            transientFailures = 0
          }
          excluded.add(decision.key)
          result = null
          if (attempt === MAX_ROUTE_ATTEMPTS - 1) {
            systemError(projectId, sessionId, i18n.t('chat.errors.allAttemptsFailed', { error: message }))
          }
        }
      }

      if (!decision) {
        systemError(projectId, sessionId, i18n.t('chat.errors.noUsableModel'))
        break
      }
      if (!result) break
      if (signal.aborted) break

      const hasTools = result.toolCalls.length > 0
      if (!result.text.trim() && !hasTools) emptyResponses++
      else emptyResponses = 0

      entries.push({
        role: 'assistant',
        content: result.text,
        ...(hasTools ? { toolCalls: result.toolCalls } : {}),
        ...(result.thinking.length > 0 ? { thinking: result.thinking } : {})
      })

      if (!hasTools) {
        persistTranscript(sessionId, entries, decision.key, decision.tier)
        break
      }

      if (loopCounter.record(result.toolCalls)) {
        const names = [...new Set(result.toolCalls.map((tc) => tc.name))].join(', ')
        systemError(
          projectId,
          sessionId,
          i18n.t('chat.errors.toolLoop', { names, rounds: MAX_REPEATED_TOOL_ROUNDS })
        )
        break
      }

      // --- Tool execution: safe calls in parallel, risky ones serially so their
      // permission prompts queue up one at a time.
      const safe: ToolCall[] = []
      const risky: ToolCall[] = []
      for (const tc of result.toolCalls) {
        (TOOL_SAFETY[tc.name] === 'safe' ? safe : risky).push(tc)
      }

      const resultsById = new Map<string, ToolResult>()
      if (safe.length > 0 && !signal.aborted) {
        const settled = await Promise.all(safe.map((tc) => executeTool(tc, projectPath, signal)))
        safe.forEach((tc, i) => resultsById.set(tc.id, settled[i]))
      }
      for (const tc of risky) {
        if (signal.aborted) break
        resultsById.set(tc.id, await executeTool(tc, projectPath, signal))
      }

      // Aborted during tool execution: drop the round's tool log entries so a
      // stopped turn never pollutes the transcript with half-run results.
      if (signal.aborted) break

      let roundErrors = 0
      for (const tc of result.toolCalls) {
        const raw = resultsById.get(tc.id) ?? {
          toolCallId: tc.id,
          content: 'Tool was not executed (run aborted).',
          isError: true
        }
        if (raw.isError) roundErrors++
        const truncated = truncateToolResult(raw)

        const toolMsgId = `${Date.now()}-tool-${tc.id}`
        useAppStore.getState().addMessage(projectId, sessionId, {
          id: toolMsgId,
          role: 'system',
          content: formatToolMessageContent(tc.name, raw.isError === true, truncated, raw.diffData),
          createdAt: Date.now()
        })

        entries.push({
          role: 'tool',
          toolCallId: tc.id,
          name: tc.name,
          content: truncated,
          isError: raw.isError === true
        })
      }

      consecutiveToolErrors = roundErrors > 0 ? consecutiveToolErrors + 1 : 0
      persistTranscript(sessionId, entries, decision.key, decision.tier)

      if (signal.aborted) break
    }

    if (round >= MAX_TOOL_ROUNDS) {
      systemError(projectId, sessionId, i18n.t('chat.errors.maxRounds', { rounds: MAX_TOOL_ROUNDS }))
    }
  } catch (err) {
    if (!signal.aborted) {
      systemError(projectId, sessionId, i18n.t('chat.errors.agentError', { error: String(err) }))
    }
  } finally {
    const isCurrent = abortController === controller
    if (isCurrent) abortController = null
    const aborted = signal.aborted
    if (isCurrent) {
      set(() => ({ isStreaming: false, streamingSessionId: null }))
      window.api.setStreaming?.(false)
      if (!aborted) {
        window.api.notification.send('pawn', 'Task complete').catch(() => {})
      }
      // Drain the queue even after a manual stop: queued messages were
      // explicitly scheduled and must not wait for the next user input.
      processQueue(set, get)
    }
  }
}

export function truncateToolResult(result: { content: string }, maxLen = 2000): string {
  if (result.content.length <= maxLen) return result.content
  return result.content.slice(0, maxLen) + `\n...(truncated ${result.content.length - maxLen} chars)`
}

function processQueue(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState
): void {
  const { queue } = get()
  if (queue.length === 0) return

  const next = queue[0]
  set((s) => ({ queue: s.queue.slice(1) }))

  setTimeout(() => {
    // A newer message grabbed the turn while we waited (e.g. steer right after
    // Stop). Keep the item queued instead of starting a second concurrent loop.
    if (get().isStreaming) {
      set((s) => ({ queue: [next, ...s.queue] }))
      return
    }
    // The bubble was rendered when the message was queued; going back through
    // sendMessage would render it a second time.
    if (!next.displayed) {
      get().sendMessage(next.projectId, next.sessionId, next.content, 'queue', next.attachments)
      return
    }
    autoTitle(next.projectId, next.sessionId, next.content)
    set(() => ({ isStreaming: true, streamingSessionId: next.sessionId }))
    window.api.setStreaming?.(true)
    void agentLoop(next.projectId, next.sessionId, next.content, set, get, next.attachments)
  }, 50)
}
