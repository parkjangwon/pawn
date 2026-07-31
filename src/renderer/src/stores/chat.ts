import { create } from 'zustand'
import { useAppStore } from './app'
import { useProviderStore } from './provider'
import { useUsageStore, type CallUsage } from './usage'
import { executeTool, toolsToOpenAI, toolsToClaude, TOOL_SAFETY, type ToolCall, type ToolResult } from '../agent/tools'
import { loadProjectContext, buildProjectContextBlock } from '../agent/skills'
import {
  route, estimateComplexity, shouldEscalate, routeKey, setSessionRoute, clearSessionRoute,
  noteProviderFailure, noteProviderSuccess,
  type RouteDecision
} from '../agent/router'
import {
  toClaudeMessages, toOpenAIMessages, sanitizeForSend, compactTranscript, estimateTokens,
  TRANSCRIPT_VERSION,
  type TranscriptEntry, type TranscriptThinking, type StoredTranscript
} from '../agent/transcript'

export type SendMode = 'queue' | 'steer'

const MAX_TOOL_ROUNDS = 25
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
  /** The bubble is already on screen from when the message was queued. */
  displayed: boolean
}

interface ChatState {
  isStreaming: boolean
  queue: QueueItem[]
  sendMessage: (projectId: string, sessionId: string, content: string, mode: SendMode) => void
  stopStreaming: () => void
}

let abortController: AbortController | null = null

/**
 * Layer 0 of the system prompt: identical for every user, project and session, so
 * it is shared cache across everything. Nothing dynamic may ever be added here.
 */
const SYSTEM_PROMPT = `You are pawn, an AI desktop agent. You help with coding, file management, shell work, browser automation, and computer control.

Tool use:
- Read a file before editing it. Prefer edit_file over write_file for existing files.
- Use grep_search and search_files to locate code instead of guessing paths.
- Batch independent read-only calls together; they run in parallel.
- Browser automation: browser_navigate to load a page, browser_snapshot to see its
  interactive elements, then browser_click / browser_fill / browser_eval to act.
  Always snapshot after a navigation or a click that changes the page.
- load_skill fetches the full text of a project skill by name. The system prompt
  lists only skill names and summaries; load the body when you actually need it.

Style:
- Be concise. Show your work through tool calls rather than narrating it.
- For multi-file or multi-step work, outline the plan in one or two sentences first.
- For a single-step request, just do it.
- Report failures plainly, including the error text.`

export const useChatStore = create<ChatState>((set, get) => ({
  isStreaming: false,
  queue: [],

  sendMessage: (projectId, sessionId, content, mode) => {
    const state = get()

    if (mode === 'queue' && state.isStreaming) {
      set({ queue: [...state.queue, { projectId, sessionId, content, displayed: true }] })
      pushUserBubble(projectId, sessionId, content)
      return
    }

    if (mode === 'steer' && state.isStreaming) {
      abortController?.abort()
    }

    pushUserBubble(projectId, sessionId, content)
    autoTitle(projectId, sessionId, content)

    set({ isStreaming: true })
    void agentLoop(projectId, sessionId, content, set, get)
  },

  stopStreaming: () => {
    abortController?.abort()
    set({ isStreaming: false })
  }
}))

function pushUserBubble(projectId: string, sessionId: string, content: string): void {
  useAppStore.getState().addMessage(projectId, sessionId, {
    id: `${Date.now()}-user-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content,
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

async function loadTranscript(projectId: string, sessionId: string): Promise<TranscriptEntry[]> {
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
          useUsageStore.getState().noteDiagnostic(sessionId, 'warn', '콜드 스타트 — 캐시가 만료돼 다시 기록해야 합니다.')
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
    if (m.role === 'user') entries.push({ role: 'user', content: m.content })
    else entries.push({ role: 'assistant', content: m.content })
  }
  // The bubble for the message being sent right now is already in the store;
  // the caller appends it explicitly, so drop the duplicate tail.
  if (entries.length > 0 && entries[entries.length - 1].role === 'user') entries.pop()
  return entries
}

function persistTranscript(sessionId: string, entries: TranscriptEntry[], warmFor: string): void {
  const payload: StoredTranscript = { version: TRANSCRIPT_VERSION, entries, warmFor, lastActivity: Date.now() }
  window.api.db.saveTranscript(sessionId, JSON.stringify(payload)).catch(() => {
    // Losing a transcript write costs a cache re-prime, never correctness.
  })
}

// --- Agent loop -------------------------------------------------------------

async function agentLoop(
  projectId: string,
  sessionId: string,
  userContent: string,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState
): Promise<void> {
  const { providers, models } = useProviderStore.getState()
  if (providers.filter((p) => p.enabled).length === 0 || models.filter((m) => m.enabled).length === 0) {
    systemError(projectId, sessionId, 'No provider or model configured. Open Settings → Providers, then Settings → Models.')
    set(() => ({ isStreaming: false }))
    processQueue(set, get)
    return
  }

  abortController = new AbortController()
  const signal = abortController.signal

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
       const block = buildProjectContextBlock(await loadProjectContext(projectPath))
        if (block) projectPreamble += (projectPreamble ? '\n\n' : '') + block
     } catch {
       // Missing CLAUDE.md / skills is normal; keep the base layer.
     }
   }
    // systemLayers stays [SYSTEM_PROMPT] only — project context is passed as
    // preamble to callLLM, where it is injected into the messages array.

   let entries = await loadTranscript(projectId, sessionId)
    entries.push({ role: 'user', content: userContent })

    const complexity = estimateComplexity(userContent)
    let consecutiveToolErrors = 0
    let emptyResponses = 0
    let round = 0
    let lastDecision: RouteDecision | null = null

    while (round < MAX_TOOL_ROUNDS) {
      if (signal.aborted) break
      round++

      // Compaction runs at a threshold and the result is persisted, so it costs
      // exactly one cache re-prime — unlike a sliding window, which would silently
      // re-prime on every single request.
      const contextWindow = lastDecision?.model.contextWindow || DEFAULT_CONTEXT_WINDOW
     if (estimateTokens(entries) > contextWindow * COMPACT_AT_RATIO) {
       entries = compactTranscript(entries)
       persistTranscript(sessionId, entries, lastDecision?.key || '')
        useUsageStore.getState().noteDiagnostic(sessionId, 'info', '컨텍스트 압축 실행 — 캐시를 다시 기록합니다.')
     }

      const escalate = shouldEscalate({ consecutiveToolErrors, round, emptyResponses })
      const excluded = new Set<string>()
      let result: LlmResult | null = null
      let decision: RouteDecision | null = null

      // Try up to MAX_ROUTE_ATTEMPTS distinct models before failing the turn.
      for (let attempt = 0; attempt < MAX_ROUTE_ATTEMPTS; attempt++) {
        if (signal.aborted) break
        decision = route({
          sessionId,
          entries,
          complexity,
          escalate,
          exclude: excluded,
          newTurn: round === 1
        })
        if (!decision) break

        const assistantMsgId = `${Date.now()}-assistant-${round}-${attempt}`
        useAppStore.getState().addMessage(projectId, sessionId, {
          id: assistantMsgId, role: 'assistant', content: '', createdAt: Date.now()
        })

        try {
         result = await callLLM({
            decision, entries, systemLayers, projectPreamble, sessionId, projectId, assistantMsgId, signal
         })
          noteProviderSuccess(decision.provider.id)
          setSessionRoute(sessionId, decision.key, decision.tier, estimateTokens(entries))
          useUsageStore.getState().noteRoute(
            sessionId,
            decision.model.label || decision.model.modelId,
            decision.reason
          )
          useUsageStore.getState().record(sessionId, decision.model, result.usage)

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
          noteProviderFailure(decision.provider.id)
          excluded.add(decision.key)
          result = null
          if (attempt === MAX_ROUTE_ATTEMPTS - 1) {
            systemError(projectId, sessionId, `All model attempts failed. Last error: ${message}`)
          }
        }
      }

      if (!decision) {
        systemError(projectId, sessionId, 'No usable model. Check that a provider is enabled and has models attached.')
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
        persistTranscript(sessionId, entries, decision.key)
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
        const settled = await Promise.all(safe.map((tc) => executeTool(tc, projectPath)))
        safe.forEach((tc, i) => resultsById.set(tc.id, settled[i]))
      }
      for (const tc of risky) {
        if (signal.aborted) break
        resultsById.set(tc.id, await executeTool(tc, projectPath))
      }

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
          content: `[Tool: ${tc.name}] ${raw.isError ? 'ERROR' : 'OK'}\n${truncated.slice(0, 500)}${
            raw.diffData
              ? `\n<<<DIFF:${raw.diffData.filename}>>>\n--- old\n${raw.diffData.oldText.slice(0, 300)}\n+++ new\n${raw.diffData.newText.slice(0, 300)}\n<<<END>>>`
              : ''
          }`,
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
      persistTranscript(sessionId, entries, decision.key)

      if (signal.aborted) break
    }

    if (round >= MAX_TOOL_ROUNDS) {
      systemError(projectId, sessionId, `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`)
    }
  } catch (err) {
    if (!signal.aborted) {
      systemError(projectId, sessionId, 'Agent loop error: ' + String(err))
    }
  } finally {
    const aborted = signal.aborted
    set(() => ({ isStreaming: false }))
    abortController = null
    if (!aborted) {
      window.api.notification.send('pawn', 'Task complete')
      processQueue(set, get)
    }
  }
}

function truncateToolResult(result: { content: string }, maxLen = 2000): string {
  if (result.content.length <= maxLen) return result.content
  return result.content.slice(0, maxLen) + `\n...(truncated ${result.content.length - maxLen} chars)`
}

// --- Cache breakpoints ------------------------------------------------------

/**
 * Anthropic allows four cache breakpoints per request. Spending them well is the
 * whole game:
 *   1. tools      — big, never changes (marked inside toolsToClaude)
 *   2. system     — stable for the session; covers tools+system in one read
 *   3/4. two rolling anchors in the conversation.
 *
 * Two conversation anchors, not one: the newest anchor is a cache *write* that
 * only pays off next turn, while the previous turn's anchor is the one that
 * actually *reads*. With a single anchor every turn writes and never reads.
 */
function withConversationCacheAnchors(
  messages: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
 if (messages.length === 0) return messages
 const out = messages.map((m) => ({ ...m }))

  const anchors: number[] = [out.length - 1]
  let prevUser = -1
  // The previous anchor is the last user-role message before the tail — in a tool
  // loop that is exactly the tool_result group this request's predecessor ended on.
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i].role === 'user') { prevUser = i; break }
  }
  if (prevUser >= 0) {
    anchors.push(prevUser)
  } else if (out.length > 1) {
    // Short conversation with no previous user message — the 4th breakpoint
    // would otherwise be wasted. Anchor the first message so its stable prefix
    // (preamble + first user turn) is cached for future turns.
    anchors.push(0)
  }

  const seen = new Set<number>()
  for (const idx of anchors) {
    if (seen.has(idx)) continue
    seen.add(idx)
    const msg = out[idx]
    if (!Array.isArray(msg.content)) continue
    const blocks = (msg.content as Array<Record<string, unknown>>).slice()
    if (blocks.length === 0) continue
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
    msg.content = blocks
  }
  return out
}

/**
 * Only genuine reasoning models accept `reasoning_effort`; OpenAI-compatible
 * gateways reject unknown parameters outright, which would break every provider
 * that is not OpenAI itself.
 */
function supportsReasoningEffort(modelId: string): boolean {
  return /(^|\/)(o[1-4](-|$)|gpt-5|deepseek-reasoner|qwq)/i.test(modelId)
}

/**
 * Inject the project preamble (cwd, CLAUDE.md, skills) into a Claude-format
 * messages array. The preamble is merged into the first user message's content
 * blocks when possible to avoid creating consecutive user messages, which some
 * API gateways reject. When there is no leading user message, a standalone one
 * is prepended.
 */
function injectClaudePreamble(
  messages: Array<Record<string, unknown>>,
  preamble: string
): Array<Record<string, unknown>> {
  if (!preamble || messages.length === 0) return messages
  const first = messages[0]
  if (first.role === 'user' && Array.isArray(first.content)) {
    return [
      { ...first, content: [{ type: 'text', text: preamble }, ...first.content as unknown[]] },
      ...messages.slice(1)
    ]
  }
  return [{ role: 'user', content: [{ type: 'text', text: preamble }] }, ...messages]
}

// --- LLM call ---------------------------------------------------------------

interface LlmResult {
  text: string
  toolCalls: ToolCall[]
  thinking: TranscriptThinking[]
 usage: CallUsage
}

interface LlmRequest {
  decision: RouteDecision
  entries: TranscriptEntry[]
  systemLayers: string[]
  projectPreamble: string
  sessionId: string
  projectId: string
  assistantMsgId: string
  signal: AbortSignal
}

async function callLLM(req: LlmRequest): Promise<LlmResult> {
  const { decision, systemLayers, projectPreamble, sessionId, projectId, assistantMsgId, signal } = req
  const { provider, model } = decision
  const { reasoningEffort } = useProviderStore.getState()
  const isBrowser = window.api?.platform === 'browser'
  const sendable = sanitizeForSend(req.entries)

  let url: string
  let body: Record<string, unknown>
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (provider.apiFormat === 'claude') {
    const budget = reasoningEffort && reasoningEffort !== 'auto'
      ? ({ low: 2048, medium: 4096, high: 8192 } as Record<string, number>)[reasoningEffort]
      : undefined

    url = `${provider.baseUrl}/messages`
    headers['x-api-key'] = provider.apiKey || ''
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model: model.modelId,
      // max_tokens must exceed the thinking budget, not merely equal it.
      max_tokens: budget ? budget + 8192 : 8192,
      stream: true,
      ...(budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {}),
      system: systemLayers.map((text, i) =>
        i === systemLayers.length - 1
          ? { type: 'text', text, cache_control: { type: 'ephemeral' } }
          : { type: 'text', text }
      ),
      tools: toolsToClaude(),
      messages: withConversationCacheAnchors(injectClaudePreamble(toClaudeMessages(sendable), projectPreamble))
    }
  } else {
    url = `${provider.baseUrl}/chat/completions`
    headers['Authorization'] = `Bearer ${provider.apiKey || ''}`
    body = {
      model: model.modelId,
      stream: true,
      // Without this the usage block never arrives on a streamed response and
      // cached_tokens can't be measured.
      stream_options: { include_usage: true },
      tools: toolsToOpenAI(),
      // OpenAI caches by exact prefix automatically; the key routes repeat
      // requests of one session to the same cache shard.
      prompt_cache_key: sessionId,
      ...(reasoningEffort && reasoningEffort !== 'auto' && supportsReasoningEffort(model.modelId)
        ? { reasoning_effort: reasoningEffort }
        : {}),
      // A single deterministic system block: layers joined in fixed order, no
      // per-turn values, so the prefix matches byte for byte across turns.
      messages: [
        { role: 'system', content: systemLayers.join('\n\n') },
        ...(projectPreamble ? [{ role: 'system', content: projectPreamble }] : []),
        ...toOpenAIMessages(sendable)
      ]
    }
  }

  const response = await fetchWithRetry(url, headers, body, isBrowser, signal)

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  // Some OpenAI-compatible reasoning models (DeepSeek Reasoner, QwQ, etc.) stream
  // their visible "thinking" in a separate `reasoning_content` field instead of
  // `content`. It has no replayable wire form on OpenAI-format APIs, so it is
  // shown live but never included in `fullText` — persisting it back as the
  // assistant's message would resend "thinking" as if it were a real answer.
  let reasoningText = ''
  const toolCalls: ToolCall[] = []
  const thinking: TranscriptThinking[] = []
  const usage: CallUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const toolBuffers = new Map<number, { id: string; name: string; args: string }>()
  const thinkingBuffers = new Map<number, TranscriptThinking>()

  const flushText = (): void => {
    const display = reasoningText ? `${reasoningText}${fullText ? '\n\n' + fullText : ''}` : fullText
    useAppStore.getState().updateMessageContent(projectId, sessionId, assistantMsgId, display)
  }

  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue

        let parsed: Record<string, any>
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }

        if (provider.apiFormat === 'claude') {
          switch (parsed.type) {
            case 'message_start': {
              const u = parsed.message?.usage || {}
              usage.inputTokens = u.input_tokens || 0
              usage.cacheReadTokens = u.cache_read_input_tokens || 0
              usage.cacheWriteTokens = u.cache_creation_input_tokens || 0
              usage.outputTokens = u.output_tokens || 0
              break
            }
            case 'message_delta': {
              if (parsed.usage?.output_tokens) usage.outputTokens = parsed.usage.output_tokens
              break
            }
            case 'content_block_start': {
              const block = parsed.content_block
              if (block?.type === 'tool_use') {
                toolBuffers.set(parsed.index, { id: block.id, name: block.name, args: '' })
              } else if (block?.type === 'thinking') {
                thinkingBuffers.set(parsed.index, { type: 'thinking', thinking: '', signature: '' })
              } else if (block?.type === 'redacted_thinking') {
                thinking.push({ type: 'redacted_thinking', data: block.data || '' })
              }
              break
            }
            case 'content_block_delta': {
              const d = parsed.delta
              if (d?.type === 'text_delta') {
                fullText += d.text
                flushText()
              } else if (d?.type === 'input_json_delta') {
                const buf = toolBuffers.get(parsed.index)
                if (buf) buf.args += d.partial_json
              } else if (d?.type === 'thinking_delta') {
                const buf = thinkingBuffers.get(parsed.index)
                if (buf) buf.thinking = (buf.thinking || '') + d.thinking
              } else if (d?.type === 'signature_delta') {
                const buf = thinkingBuffers.get(parsed.index)
                if (buf) buf.signature = (buf.signature || '') + d.signature
              }
              break
            }
            case 'content_block_stop': {
              const buf = toolBuffers.get(parsed.index)
              if (buf) {
                toolCalls.push({ id: buf.id, name: buf.name, arguments: safeParseArgs(buf.args) })
                toolBuffers.delete(parsed.index)
              }
              const think = thinkingBuffers.get(parsed.index)
              if (think) {
                thinking.push(think)
                thinkingBuffers.delete(parsed.index)
              }
              break
            }
            case 'error': {
              throw new Error(parsed.error?.message || 'stream error')
            }
          }
          continue
        }

        // OpenAI-compatible stream
        if (parsed.usage) {
          const cached = parsed.usage.prompt_tokens_details?.cached_tokens || 0
          usage.cacheReadTokens = cached
          usage.inputTokens = Math.max(0, (parsed.usage.prompt_tokens || 0) - cached)
          usage.outputTokens = parsed.usage.completion_tokens || 0
        }
        const choice = parsed.choices?.[0]
        if (!choice) continue

        if (choice.delta?.content) {
          fullText += choice.delta.content
          flushText()
        }
        if (typeof choice.delta?.reasoning_content === 'string' && choice.delta.reasoning_content) {
          reasoningText += choice.delta.reasoning_content
          flushText()
        }
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? 0
            let buf = toolBuffers.get(idx)
            if (!buf) {
              buf = { id: tc.id || `call_${idx}`, name: tc.function?.name || '', args: '' }
              toolBuffers.set(idx, buf)
            }
            if (tc.id) buf.id = tc.id
            if (tc.function?.name) buf.name = tc.function.name
            if (tc.function?.arguments) buf.args += tc.function.arguments
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  // Flush any tool buffers the stream never closed. Anthropic closes every block,
  // but OpenAI-compatible gateways routinely omit finish_reason.
  const seen = new Set(toolCalls.map((tc) => tc.id))
  for (const buf of toolBuffers.values()) {
    if (seen.has(buf.id) || !buf.name) continue
    toolCalls.push({ id: buf.id, name: buf.name, arguments: safeParseArgs(buf.args) })
    seen.add(buf.id)
  }

  return { text: fullText, toolCalls, thinking, usage }
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Retry only what is worth retrying on the *same* model: rate limits, 5xx and
 * network blips. A 4xx is a bad request and will fail identically forever, so it
 * propagates immediately and lets the router fail over to another model.
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  isBrowser: boolean,
  signal: AbortSignal
): Promise<Response> {
  const payload = JSON.stringify(body)
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 700 * (1 << (attempt - 1))))
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    }

    try {
      const response = isBrowser
        ? await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, headers, body: payload }),
            signal
          })
        : await fetch(url, { method: 'POST', headers, body: payload, signal })

      if (response.ok) return response

      const status = response.status
      const text = await response.text().catch(() => '')
      const err = new Error(`HTTP ${status}: ${text.slice(0, 300)}`)
      if (status === 429 || status >= 500) {
        lastError = err
        continue
      }
      throw err
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (signal.aborted) throw err
      lastError = err as Error
      // A thrown non-HTTP error is a network failure; retry it.
      if (attempt === 2) throw lastError
    }
  }

  throw lastError ?? new Error('request failed')
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
    // The bubble was rendered when the message was queued; going back through
    // sendMessage would render it a second time.
    if (!next.displayed) {
      get().sendMessage(next.projectId, next.sessionId, next.content, 'queue')
      return
    }
    autoTitle(next.projectId, next.sessionId, next.content)
    set(() => ({ isStreaming: true }))
    void agentLoop(next.projectId, next.sessionId, next.content, set, get)
  }, 50)
}
