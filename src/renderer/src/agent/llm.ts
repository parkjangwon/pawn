/**
 * Provider wire calls: conversation cache anchors, preamble injection and the
 * streaming call itself (OpenAI-compatible and Claude formats).
 */
import { useAppStore } from '../stores/app'
import { useStreamingStore } from '../stores/streaming'
import { useProviderStore } from '../stores/provider'
import { toolsToClaude, toolsToOpenAI, getMcpToolDefinitions, type ToolCall } from './tools'
import { NATIVE_DUPLICATES, claudeComputerVersion, planNativeComputer } from './computerToolset'
import { noteComputerModel, shotPolicyFor } from './toolHandlers/computer'
import { planApplyPatch, planClaudeNativeTools } from './nativeTools'
import { buildKiroRequest, kiroConversationId, type KiroRequestBuild } from './kiroWire'
import { applyProviderAuth } from './subscriptionSession'
import { AntigravityStream, ResponsesStream, rewriteSubscriptionCall, type WireSink } from './subscriptionWire'
import { estimateCharsAsTokens } from './transcript'
import type { CallUsage } from '../stores/usage'
import type { RouteDecision } from './router'
import {
  claudeThinkingBudget, deepSeekEffort, effectiveReasoningEffort, type HarnessMode
} from './harnessMode'
import {
  sanitizeForSend, stripStaleVisionPayloads, toClaudeMessages, toOpenAIMessages,
  type TranscriptEntry, type TranscriptThinking
} from './transcript'
import {
  deepSeekAnthropicBodyExtras,
  deepSeekChatBodyExtras,
  deepSeekChatCompletionsUrl,
  deepSeekMaxTokens,
  deepSeekUserId,
  isDeepSeekAnthropicBase,
  isDeepSeekModel,
  isDeepSeekOfficialHost,
  needsReasoningContentEcho,
  parseCompatUsage,
  type Complexity
} from './deepseekCompat'
import { fetchWithRetry, markTransient } from './llmRetry'

// Retry/transport policy was split into llmRetry.ts; re-export so existing
// importers (ultraWork, learning, compaction, secondOpinion) keep working.
export { parseRetryAfterHeader, calculateBackoffDelay, markTransient, fetchWithRetry } from './llmRetry'

export function withConversationCacheAnchors(
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
export function supportsReasoningEffort(modelId: string): boolean {
  // DeepSeek uses deepSeekChatBodyExtras (thinking + reasoning_effort) instead
  // of bare reasoning_effort alone.
  if (isDeepSeekModel(modelId)) return false
  return /(^|\/)(o[1-4](-|$)|gpt-5|qwq|grok-4)/i.test(modelId)
}

/**
 * Inject the project preamble (cwd, CLAUDE.md, skills) into a Claude-format
 * messages array. The preamble is merged into the first user message's content
 * blocks when possible to avoid creating consecutive user messages, which some
 * API gateways reject. When there is no leading user message, a standalone one
 * is prepended.
 */
export function injectClaudePreamble(
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

export interface LlmResult {
  text: string
  toolCalls: ToolCall[]
  thinking: TranscriptThinking[]
  /** OpenAI-compat `reasoning_content` (DeepSeek thinking mode) for replay. */
  reasoningContent?: string
  usage: CallUsage
}

export interface LlmRequest {
  decision: RouteDecision
  entries: TranscriptEntry[]
  systemLayers: string[]
  projectPreamble: string
  sessionId: string
  projectId: string
  projectPath?: string
  assistantMsgId: string
  signal: AbortSignal
  /** Drives DeepSeek thinking effort / max_tokens when UI effort is auto. */
  complexity?: Complexity
  /** When set, only these tools are exposed (subagent explore mode). */
  toolAllowlist?: string[]
  /** When set, these tools are removed from the exposed list (subagent worker). */
  toolDenylist?: string[]
  /** Plain completion: no tools at all (e.g. drafting a skill from a recording). */
  noTools?: boolean
  /** Harness mode override (subagents pass the parent session's mode). */
  harnessMode?: HarnessMode
  /**
   * Called as soon as each tool call's arguments are complete, while the rest
   * of the response is still streaming (lets read-only tools start early).
   */
  onToolCall?: (call: ToolCall) => void
}

/** No data for this long means the provider connection is dead; bail out. */
const STREAM_IDLE_TIMEOUT_MS = 90_000
const NO_TOOLS_SENTINEL = '__pawn_no_tools__'

export async function callLLM(req: LlmRequest): Promise<LlmResult> {
  const {
    decision, systemLayers, projectPreamble, sessionId, projectId, projectPath,
    assistantMsgId, signal, complexity, toolAllowlist, toolDenylist
  } = req
  const toolListOpts = {
    mode: useProviderStore.getState().agentModeFor(sessionId),
    // No real tool is named this: an allowlist of it exposes nothing.
    allowlist: req.noTools ? [NO_TOOLS_SENTINEL] : toolAllowlist,
    denylist: toolDenylist
  }
  const { provider, model } = decision
  noteComputerModel(model.modelId)
  const providerState = useProviderStore.getState()
  const userEffort = providerState.reasoningEffort || 'auto'
  const harnessMode = req.harnessMode ?? providerState.harnessModeFor?.(sessionId) ?? 'default'
  // Harness mode shifts the default only; an explicit user effort always wins.
  // OpenAI-style reasoning_effort, DeepSeek, and Claude thinking map differently.
  const reasoningEffort = effectiveReasoningEffort(userEffort, harnessMode)
  const dsEffort = deepSeekEffort(userEffort, harnessMode)
  const isBrowser = window.api?.platform === 'browser'
  // Drop pre-turn screenshots so old computer-use frames do not force vision
  // tokens or bloated prompts on later text turns.
  const sendable = stripStaleVisionPayloads(sanitizeForSend(req.entries))
  const mcpTools = projectPath && !req.noTools ? await getMcpToolDefinitions(projectPath) : []

  let url: string
  let body: Record<string, unknown>
  let headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const authedProvider = await applyProviderAuth(provider)
  const token = authedProvider.apiKey || ''

  // Idle timeout: a stalled stream must not hold the turn forever. It aborts
  // the fetch/reader through a combined signal and surfaces as a transient
  // error so the router retries on another model.
  const timeoutController = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => timeoutController.abort(), STREAM_IDLE_TIMEOUT_MS)
  }
  const combinedSignal = AbortSignal.any([signal, timeoutController.signal])

  const deepSeekModel = isDeepSeekModel(model.modelId)
  const deepSeekHost = isDeepSeekOfficialHost(provider.baseUrl)
  const deepSeekAnthropic = deepSeekHost && (
    provider.apiFormat === 'claude' || isDeepSeekAnthropicBase(provider.baseUrl)
  )
  const dsUser = deepSeekHost ? deepSeekUserId(projectId, sessionId) : undefined

  let kiroBuild: KiroRequestBuild | null = null
  if (provider.apiFormat === 'kiro') {
    // Kiro (CodeWhisperer protocol): the main process holds the credentials
    // and streams normalized events back; here we only build the request.
    const openAITools = openAIToolsWithPatch(toolsToOpenAI(mcpTools, toolListOpts), model.modelId)
    kiroBuild = buildKiroRequest({
      entries: sendable,
      systemText: [...systemLayers, joinPreamble(projectPreamble, openAITools.note)].filter(Boolean).join('\n\n'),
      tools: openAITools.tools.map((t) => {
        const f = t.function as { name: string; description?: string; parameters?: Record<string, unknown> }
        return { name: f.name, description: f.description || '', parameters: f.parameters || { type: 'object', properties: {} } }
      }),
      modelId: model.modelId,
      conversationId: kiroConversationId(sessionId)
    })
    url = 'kiro:generateAssistantResponse'
    body = kiroBuild.body
  } else if (provider.apiFormat === 'claude' || deepSeekAnthropic) {
    const budget = claudeThinkingBudget(userEffort, harnessMode)
    const claudeTools = await claudeToolsWithNative(toolsToClaude(mcpTools, toolListOpts), provider, model.modelId, headers)

    // DeepSeek Anthropic base: https://api.deepseek.com/anthropic (+ /messages)
    url = deepSeekAnthropic
      ? deepSeekChatCompletionsUrl(provider.baseUrl.includes('/anthropic')
        ? provider.baseUrl
        : `${provider.baseUrl.replace(/\/+$/, '')}/anthropic`)
      : `${provider.baseUrl.replace(/\/+$/, '')}/messages`
    headers['x-api-key'] = token
    headers['anthropic-version'] = '2023-06-01'
    const dsAnth = deepSeekAnthropic
      ? deepSeekAnthropicBodyExtras({
        modelId: model.modelId,
        reasoningEffort: dsEffort,
        complexity,
        userId: dsUser
      })
      : {}
    body = {
      model: model.modelId,
      // Coding turns need headroom; DeepSeek ignores budget_tokens on Anthropic path.
      max_tokens: deepSeekModel
        ? deepSeekMaxTokens({ modelId: model.modelId, reasoningEffort: dsEffort, complexity })
        : budget
          ? budget + 16_384
          : 16_384,
      stream: true,
      ...(deepSeekAnthropic
        ? dsAnth
        : budget
          ? { thinking: { type: 'enabled', budget_tokens: budget } }
          : {}),
      system: systemLayers.map((text, i) =>
        i === systemLayers.length - 1
          ? { type: 'text', text, cache_control: { type: 'ephemeral' } }
          : { type: 'text', text }
      ),
      tools: claudeTools.tools,
      messages: withConversationCacheAnchors(
        injectClaudePreamble(toClaudeMessages(sendable), joinPreamble(projectPreamble, claudeTools.note))
      )
    }
  } else {
    // OpenAI-compatible; DeepSeek docs: base https://api.deepseek.com → /chat/completions
    url = deepSeekHost
      ? deepSeekChatCompletionsUrl(provider.baseUrl)
      : `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
    headers['Authorization'] = `Bearer ${token}`
    // Xiaomi MiMo curl samples use `api-key`; OpenAI SDK uses Bearer — send both.
    if (/xiaomimimo\.com/i.test(provider.baseUrl || '')) {
      headers['api-key'] = token
    }
    const openAITools = openAIToolsWithPatch(toolsToOpenAI(mcpTools, toolListOpts), model.modelId)
    const deepSeekExtras = deepSeekChatBodyExtras({
      modelId: model.modelId,
      reasoningEffort: dsEffort,
      complexity
    })
    body = {
      model: model.modelId,
      stream: true,
      // Required for usage + prompt_cache_hit_tokens on DeepSeek streams.
      stream_options: { include_usage: true },
      // DeepSeek: CoT counts toward max_tokens (thinking mode). API max output 384K.
      max_tokens: deepSeekModel
        ? deepSeekMaxTokens({ modelId: model.modelId, reasoningEffort: dsEffort, complexity })
        : 16_384,
      tools: openAITools.tools,
      ...(reasoningEffort && reasoningEffort !== 'auto' && supportsReasoningEffort(model.modelId)
        ? { reasoning_effort: reasoningEffort }
        : {}),
      // thinking + reasoning_effort (must echo reasoning_content when tools present).
      ...deepSeekExtras,
      // user_id: safety + KV isolation + scheduling (docs rate_limit).
      ...(deepSeekHost && dsUser ? { user_id: dsUser } : {}),
      // Stable system prefix first — disk cache hits require byte-stable prefixes.
      messages: [
        { role: 'system', content: systemLayers.join('\n\n') },
        ...(joinPreamble(projectPreamble, openAITools.note) ? [{ role: 'system', content: joinPreamble(projectPreamble, openAITools.note) }] : []),
        ...toOpenAIMessages(sendable, {
          echoReasoningContent: needsReasoningContentEcho(model.modelId)
        })
      ]
    }
  }

  // OpenAI rejects `tools: []`; an empty list means "no tools" everywhere.
  if (body && Array.isArray((body as { tools?: unknown }).tools) && (body as { tools: unknown[] }).tools.length === 0) {
    delete (body as { tools?: unknown }).tools
  }

  const wired = rewriteSubscriptionCall({
    provider: authedProvider,
    url,
    headers,
    body,
    stream: true
  })
  url = wired.url
  headers = wired.headers
  body = wired.body

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  // DeepSeek / QwQ stream thinking in `reasoning_content` (not `content`).
  // Shown live for UX, and persisted as `reasoningContent` so tool-loop
  // follow-ups can echo it back (DeepSeek 400 without that field).
  let reasoningText = ''
  const toolCalls: ToolCall[] = []
  const thinking: TranscriptThinking[] = []
  const usage: CallUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const toolBuffers = new Map<number, { id: string; name: string; args: string; toolset?: string }>()
  const thinkingBuffers = new Map<number, TranscriptThinking>()
  const emitted = new Set<string>()
  const emitToolCall = (call: ToolCall): void => {
    if (!req.onToolCall || emitted.has(call.id) || call.arguments?.__parse_error === true) return
    emitted.add(call.id)
    try {
      req.onToolCall(call)
    } catch {
      /* early execution is an optimization only */
    }
  }
  const emitOpenAIBuffer = (buf: { id: string; name: string; args: string }): void => {
    if (!buf.name || emitted.has(buf.id)) return
    const args = safeParseArgs(buf.args)
    if (args.__parse_error === true) return
    emitToolCall({ id: buf.id, name: buf.name, arguments: args })
  }

  // Throttle store updates to one per animation frame: a long stream otherwise
  // re-renders the whole chat on every token.
  // Content and thinking are separate channels so the UI can show a collapsible
  // Thinking block without polluting the final answer bubble.
  let lastFlushed = ''
  let lastThinkingFlushed = ''
  let pendingDisplay: string | null = null
  let pendingThinking: string | null = null
  let rafId: number | null = null

  const liveThinkingText = (): string => {
    let claude = ''
    for (const t of thinkingBuffers.values()) {
      if (t.thinking) claude += t.thinking
    }
    for (const t of thinking) {
      if (t.type === 'thinking' && t.thinking) claude += t.thinking
    }
    return reasoningText || claude
  }

  const applyFlush = (display: string, think: string): void => {
    lastFlushed = display
    lastThinkingFlushed = think
    useStreamingStore.getState().setContent(assistantMsgId, display)
    if (think) useStreamingStore.getState().setThinking(assistantMsgId, think)
  }

  const flushText = (): void => {
    const display = fullText
    const think = liveThinkingText()
    if (display === lastFlushed && think === lastThinkingFlushed) return
    pendingDisplay = display
    pendingThinking = think
    if (rafId !== null) return
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(() => {
        rafId = null
        const next = pendingDisplay ?? lastFlushed
        const nextT = pendingThinking ?? lastThinkingFlushed
        pendingDisplay = null
        pendingThinking = null
        if (next !== lastFlushed || nextT !== lastThinkingFlushed) {
          applyFlush(next, nextT)
        }
      })
    } else {
      pendingDisplay = null
      pendingThinking = null
      applyFlush(display, think)
    }
  }

  const wireSink: WireSink = {
    text: (delta) => {
      fullText += delta
      flushText()
    },
    reasoning: (delta) => {
      reasoningText += delta
      flushText()
    },
    tool: (call) => {
      toolCalls.push(call)
      emitToolCall(call)
    },
    usage: (partial) => {
      if (typeof partial.inputTokens === 'number') usage.inputTokens = partial.inputTokens
      if (typeof partial.outputTokens === 'number') usage.outputTokens = partial.outputTokens
      if (typeof partial.cacheReadTokens === 'number') usage.cacheReadTokens = partial.cacheReadTokens
    },
    error: (message) => {
      throw markTransient(new Error(message), true)
    }
  }
  const responsesStream = new ResponsesStream(wireSink)
  const antigravityStream = new AntigravityStream(wireSink)

  const flushNow = (): void => {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
    rafId = null
    const display = pendingDisplay !== null ? pendingDisplay : fullText
    const think =
      pendingThinking !== null ? pendingThinking : liveThinkingText() || lastThinkingFlushed
    pendingDisplay = null
    pendingThinking = null
    lastFlushed = display || lastFlushed
    lastThinkingFlushed = think || lastThinkingFlushed
    const finalText = lastFlushed || display || fullText
    useStreamingStore.getState().setContentNow(assistantMsgId, finalText)
    if (lastThinkingFlushed) {
      useStreamingStore.getState().setThinkingNow(assistantMsgId, lastThinkingFlushed)
      useAppStore
        .getState()
        .updateMessageThinking?.(projectId, sessionId, assistantMsgId, lastThinkingFlushed)
    }
    useAppStore.getState().updateMessageContent(projectId, sessionId, assistantMsgId, finalText, true)
    useStreamingStore.getState().clear(assistantMsgId)
  }

  if (kiroBuild) {
    const build = kiroBuild
    let contextPct = 0
    let meteredOut = 0
    armIdleTimer()
    try {
      for await (const ev of kiroEvents(build.body, combinedSignal, armIdleTimer)) {
        if (ev.type === 'text') {
          fullText += ev.text
          flushText()
        } else if (ev.type === 'reasoning') {
          reasoningText += ev.text
          flushText()
        } else if (ev.type === 'toolUse') {
          const call: ToolCall = {
            id: ev.id,
            name: build.toolNames.get(ev.name) ?? ev.name,
            arguments: ev.parseError ? { __parse_error: true, __raw: '', __message: `Kiro tool input was not valid JSON: ${ev.parseError}` } : ev.input
          }
          toolCalls.push(call)
          emitToolCall(call)
        } else if (ev.type === 'usage') {
          if (typeof ev.contextUsagePercentage === 'number') contextPct = ev.contextUsagePercentage
          if (typeof ev.inputTokens === 'number') usage.inputTokens = ev.inputTokens
          if (typeof ev.outputTokens === 'number') meteredOut = ev.outputTokens
        } else if (ev.type === 'error') {
          throw markTransient(new Error(ev.message), ev.transient)
        }
      }
    } catch (err) {
      if (timeoutController.signal.aborted && !signal.aborted) {
        throw markTransient(new Error('Kiro stream timed out (no data received for 90s)'), true)
      }
      throw err
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      try {
        flushNow()
      } catch {
        /* store optional in tests */
      }
    }
    // Kiro reports context use as a percentage, not tokens.
    if (!usage.inputTokens && contextPct > 0) usage.inputTokens = Math.round((contextPct / 100) * (model.contextWindow || 200_000))
    usage.outputTokens =
      meteredOut || estimateCharsAsTokens(fullText + reasoningText + toolCalls.map((tc) => JSON.stringify(tc.arguments)).join(''))
    return {
      text: fullText,
      toolCalls,
      thinking,
      usage
    }
  }

  armIdleTimer()
  let response: Response
  try {
    response = await fetchWithRetry(url, headers, body, isBrowser, combinedSignal)
  } catch (err) {
    if (timeoutController.signal.aborted) {
      throw markTransient(new Error('Provider request timed out (no response within 90s)'), true)
    }
    throw err
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        if (timeoutController.signal.aborted) {
          throw markTransient(new Error('Provider stream timed out (no data received for 90s)'), true)
        }
        throw err
      }
      armIdleTimer()
      const { done, value } = chunk
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        // DeepSeek keep-alive: SSE comments (`: keep-alive`) and blank lines
        // (https://api-docs.deepseek.com/quick_start/rate_limit).
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        let data = ''
        if (trimmed.startsWith('data:')) data = trimmed.slice(5).trim()
        else if (wired.streamKind === 'antigravity' && trimmed.startsWith('{')) data = trimmed
        else continue
        if (!data || data === '[DONE]') continue

        let parsed: Record<string, any>
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }

        if (wired.streamKind === 'responses') {
          responsesStream.consume(parsed)
          continue
        }
        if (wired.streamKind === 'antigravity') {
          antigravityStream.consume(parsed)
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
                toolBuffers.set(parsed.index, {
                  id: block.id,
                  name: block.name,
                  args: '',
                  ...(typeof block.toolset_name === 'string' ? { toolset: block.toolset_name } : {})
                })
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
                flushText()
              } else if (d?.type === 'signature_delta') {
                const buf = thinkingBuffers.get(parsed.index)
                if (buf) buf.signature = (buf.signature || '') + d.signature
              }
              break
            }
            case 'content_block_stop': {
              const buf = toolBuffers.get(parsed.index)
              if (buf) {
                const call: ToolCall = {
                  id: buf.id,
                  name: buf.name,
                  arguments: buf.args.trim() ? safeParseArgs(buf.args) : {},
                  ...(buf.toolset ? { toolset: buf.toolset } : {})
                }
                toolCalls.push(call)
                toolBuffers.delete(parsed.index)
                emitToolCall(call)
              }
              const think = thinkingBuffers.get(parsed.index)
              if (think) {
                thinking.push(think)
                thinkingBuffers.delete(parsed.index)
              }
              break
            }
            case 'error': {
              throw markTransient(new Error(parsed.error?.message || 'stream error'), true)
            }
          }
          continue
        }

        // OpenAI-compatible stream (DeepSeek: prompt_cache_hit/miss_tokens)
        if (parsed.usage) {
          const u = parseCompatUsage(parsed.usage as Record<string, unknown>)
          usage.inputTokens = u.inputTokens
          usage.outputTokens = u.outputTokens
          usage.cacheReadTokens = u.cacheReadTokens
          if (u.cacheWriteTokens > 0) usage.cacheWriteTokens = u.cacheWriteTokens
        }
        const choice = parsed.choices?.[0]
        if (!choice) continue

        if (choice.delta?.content) {
          fullText += choice.delta.content
          flushText()
        }
        // DeepSeek streams CoT as reasoning_content (and sometimes reasoning).
        const deltaReasoning =
          (typeof choice.delta?.reasoning_content === 'string' && choice.delta.reasoning_content) ||
          (typeof choice.delta?.reasoning === 'string' && choice.delta.reasoning) ||
          ''
        if (deltaReasoning) {
          reasoningText += deltaReasoning
          flushText()
        }
        // Finished message payload (some gateways only set this once).
        const msgReasoning =
          (typeof choice.message?.reasoning_content === 'string' && choice.message.reasoning_content) ||
          (typeof choice.message?.reasoning === 'string' && choice.message.reasoning) ||
          ''
        if (msgReasoning && msgReasoning.length > reasoningText.length) {
          reasoningText = msgReasoning
          flushText()
        }
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? 0
            let buf = toolBuffers.get(idx)
            if (!buf) {
              // Calls stream in index order: a new index means every earlier
              // one is complete and can start executing.
              for (const [i, prev] of Array.from(toolBuffers.entries())) {
                if (i < idx) emitOpenAIBuffer(prev)
              }
              buf = { id: tc.id || `call_${idx}`, name: tc.function?.name || '', args: '' }
              toolBuffers.set(idx, buf)
            }
            if (tc.id) buf.id = tc.id
            if (tc.function?.name) buf.name = tc.function.name
            if (tc.function?.arguments) {
              buf.args += tc.function.arguments
              // Complete JSON can't be extended (no trailing content), so a
              // parseable object means this call's arguments are final.
              if (req.onToolCall && buf.args.trimEnd().endsWith('}')) emitOpenAIBuffer(buf)
            }
          }
        }
        // All calls are complete once the choice finishes (usage may still follow).
        if (choice.finish_reason) {
          for (const buf of Array.from(toolBuffers.values())) emitOpenAIBuffer(buf)
        }
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    try {
      await reader.cancel()
    } catch {
      /* already closed */
    }
    // Always land the latest tokens into the message store, even on abort,
    // so the UI does not flash empty after Stop mid-stream.
    try {
      flushNow()
    } catch {
      /* store optional in tests */
    }
  }

  // Flush any tool buffers the stream never closed. Anthropic closes every block,
  // but OpenAI-compatible gateways routinely omit finish_reason.
  const seen = new Set(toolCalls.map((tc) => tc.id))
  for (const buf of toolBuffers.values()) {
    if (seen.has(buf.id) || !buf.name) continue
    toolCalls.push({ id: buf.id, name: buf.name, arguments: safeParseArgs(buf.args) })
    seen.add(buf.id)
  }

  return {
    text: fullText,
    toolCalls,
    thinking,
    ...(reasoningText ? { reasoningContent: reasoningText } : {}),
    usage
  }
}

/**
 * Kiro stream over the main-process bridge: start the request, then yield the
 * normalized events for this request id until done / error / abort.
 */
async function* kiroEvents(body: Record<string, unknown>, signal: AbortSignal, onActivity: () => void): AsyncGenerator<KiroEventDto> {
  const api = window.api?.kiro
  if (!api?.chatStart) throw markTransient(new Error('Kiro is only available in the desktop app (or pawn-headless).'), false)
  const requestId = `kiro-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const queue: KiroEventDto[] = []
  let finished = false
  let wake: (() => void) | null = null
  const off = api.onEvent(({ requestId: id, event }) => {
    if (id !== requestId) return
    queue.push(event)
    if (event.type === 'done' || event.type === 'error') finished = true
    const w = wake
    wake = null
    w?.()
  })
  const onAbort = (): void => {
    void api.chatAbort(requestId).catch(() => {})
    const w = wake
    wake = null
    w?.()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const started = await api.chatStart(requestId, body)
    if (!started.ok) throw markTransient(new Error(started.error || 'Kiro request failed'), false)
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const ev = queue.shift()
      if (!ev) {
        if (finished) return
        await new Promise<void>((r) => {
          wake = r
        })
        continue
      }
      onActivity()
      if (ev.type === 'done') return
      yield ev
    }
  } finally {
    off()
    signal.removeEventListener('abort', onAbort)
    if (!finished) void api.chatAbort(requestId).catch(() => {})
  }
}

/**
 * Parse streamed tool arguments. On failure, mark the call so the executor can
 * refuse to run with empty `{}` (which causes silent bad tool use loops).
 */
let displaySizeCache: { key: string; at: number; size: { width: number; height: number } } | null = null

/** Screenshot size the native computer tool is declared with (cached briefly). */
async function nativeDisplaySize(modelId: string): Promise<{ width: number; height: number } | undefined> {
  const exec = window.api?.computer?.exec
  if (typeof exec !== 'function') return undefined
  const policy = shotPolicyFor(modelId)
  const key = `${policy.maxLongEdge}:${policy.maxPixels}`
  if (displaySizeCache && displaySizeCache.key === key && Date.now() - displaySizeCache.at < 30_000) return displaySizeCache.size
  try {
    const res = await exec('display_size', {}, policy)
    const w = Number(res.data?.width)
    const h = Number(res.data?.height)
    if (!res.ok || !(w > 0) || !(h > 0)) return undefined
    displaySizeCache = { key, at: Date.now(), size: { width: w, height: h } }
    return displaySizeCache.size
  } catch {
    return undefined
  }
}

/**
 * Swap Pawn's duplicate computer_* tools for Claude's native computer tool
 * when the model/provider supports it (see agent/computerToolset.ts).
 */
export async function claudeToolsWithComputer(
  tools: Array<Record<string, unknown>>,
  provider: { apiFormat: string; baseUrl: string },
  modelId: string,
  headers: Record<string, string>
): Promise<Array<Record<string, unknown>>> {
  const names = tools.map((t) => String(t.name || ''))
  const desktop = typeof window.api?.computer?.exec === 'function' && window.api?.platform !== 'browser'
  const version = claudeComputerVersion(modelId)
  const needsDims = version !== null && version !== 'toolset_20260801'
  const plan = planNativeComputer({
    apiFormat: provider.apiFormat,
    baseUrl: provider.baseUrl,
    modelId,
    toolNames: names,
    desktop,
    display: needsDims && desktop ? await nativeDisplaySize(modelId) : undefined,
    enabled: useProviderStore.getState().nativeComputerTool !== false
  })
  if (!plan) return tools
  const kept = tools
    .filter((t) => !NATIVE_DUPLICATES.has(String(t.name || '')))
    .map((t) => {
      const { cache_control: _c, ...rest } = t
      return rest
    })
  kept.push({ ...plan.entry, cache_control: { type: 'ephemeral' } })
  if (plan.betaHeader) {
    headers['anthropic-beta'] = headers['anthropic-beta'] ? `${headers['anthropic-beta']},${plan.betaHeader}` : plan.betaHeader
  }
  return kept
}

function joinPreamble(preamble: string, note: string): string {
  if (!note) return preamble
  return preamble ? `${preamble}\n\n${note}` : note
}

/**
 * Claude request tools: model-native coding tools (text editor + bash) and
 * the native computer tool replace their Pawn duplicates. Exactly one
 * cache_control breakpoint stays on the last tool.
 */
export async function claudeToolsWithNative(
  tools: Array<Record<string, unknown>>,
  provider: { apiFormat: string; baseUrl: string },
  modelId: string,
  headers: Record<string, string>
): Promise<{ tools: Array<Record<string, unknown>>; note: string }> {
  const settings = useProviderStore.getState()
  const coding = planClaudeNativeTools({
    apiFormat: provider.apiFormat,
    baseUrl: provider.baseUrl,
    modelId,
    toolNames: tools.map((t) => String(t.name || '')),
    platform: window.api?.platform,
    enabled: settings.nativeCodingTools !== false
  })
  let list = tools
  if (coding) {
    list = [
      ...tools.filter((t) => !coding.drop.has(String(t.name || ''))).map(({ cache_control: _c, ...rest }) => rest),
      ...coding.entries
    ]
    list[list.length - 1] = { ...list[list.length - 1], cache_control: { type: 'ephemeral' } }
  }
  const withComputer = await claudeToolsWithComputer(list, provider, modelId, headers)
  return { tools: withComputer, note: coding?.note ?? '' }
}

/** OpenAI-format tools: apply_patch replaces edit_file / write_file for GPT-family models. */
export function openAIToolsWithPatch(
  tools: Array<Record<string, unknown>>,
  modelId: string
): { tools: Array<Record<string, unknown>>; note: string } {
  const names = tools.map((t) => String((t.function as { name?: string } | undefined)?.name || ''))
  const plan = planApplyPatch(modelId, names, useProviderStore.getState().nativeCodingTools !== false)
  if (!plan) return { tools, note: '' }
  return {
    tools: [
      ...tools.filter((t) => !plan.drop.has(String((t.function as { name?: string } | undefined)?.name || ''))),
      { type: 'function', function: { name: plan.add.name, description: plan.add.description, parameters: plan.add.parameters } }
    ],
    note: '--- Native tools on this connection ---\napply_patch replaces edit_file / write_file here: edit, create, move and delete files with one patch.'
  }
}

export function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {
      __parse_error: true,
      __raw: raw.slice(0, 500),
      __message: 'Tool arguments were not a JSON object'
    }
  } catch (err) {
    return {
      __parse_error: true,
      __raw: raw.slice(0, 500),
      __message: err instanceof Error ? err.message : 'Invalid tool argument JSON'
    }
  }
}
