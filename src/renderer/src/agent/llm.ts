/**
 * Provider wire calls: conversation cache anchors, preamble injection and the
 * streaming call itself (OpenAI-compatible and Claude formats).
 */
import { useAppStore } from '../stores/app'
import { useStreamingStore } from '../stores/streaming'
import { useProviderStore } from '../stores/provider'
import { toolsToClaude, toolsToOpenAI, getMcpToolDefinitions, type ToolCall } from './tools'
import type { CallUsage } from '../stores/usage'
import type { RouteDecision } from './router'
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
  isDeepSeekRetryableError,
  needsReasoningContentEcho,
  parseCompatUsage,
  type Complexity
} from './deepseekCompat'

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
}

/** No data for this long means the provider connection is dead; bail out. */
const STREAM_IDLE_TIMEOUT_MS = 90_000

export async function callLLM(req: LlmRequest): Promise<LlmResult> {
  const {
    decision, systemLayers, projectPreamble, sessionId, projectId, projectPath,
    assistantMsgId, signal, complexity, toolAllowlist, toolDenylist
  } = req
  const toolListOpts = {
    allowlist: toolAllowlist,
    denylist: toolDenylist
  }
  const { provider, model } = decision
  const { reasoningEffort } = useProviderStore.getState()
  const isBrowser = window.api?.platform === 'browser'
  // Drop pre-turn screenshots so old computer-use frames do not force vision
  // tokens or bloated prompts on later text turns.
  const sendable = stripStaleVisionPayloads(sanitizeForSend(req.entries))
  const mcpTools = projectPath ? await getMcpToolDefinitions(projectPath) : []

  let url: string
  let body: Record<string, unknown>
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = provider.apiKey || ''

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

  if (provider.apiFormat === 'claude' || deepSeekAnthropic) {
    const budget = reasoningEffort && reasoningEffort !== 'auto'
      ? ({ low: 2048, medium: 4096, high: 8192 } as Record<string, number>)[reasoningEffort]
      : undefined

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
        reasoningEffort,
        complexity,
        userId: dsUser
      })
      : {}
    body = {
      model: model.modelId,
      // Coding turns need headroom; DeepSeek ignores budget_tokens on Anthropic path.
      max_tokens: deepSeekModel
        ? deepSeekMaxTokens({ modelId: model.modelId, reasoningEffort, complexity })
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
      tools: toolsToClaude(mcpTools, toolListOpts),
      messages: withConversationCacheAnchors(injectClaudePreamble(toClaudeMessages(sendable), projectPreamble))
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
    const deepSeekExtras = deepSeekChatBodyExtras({
      modelId: model.modelId,
      reasoningEffort,
      complexity
    })
    body = {
      model: model.modelId,
      stream: true,
      // Required for usage + prompt_cache_hit_tokens on DeepSeek streams.
      stream_options: { include_usage: true },
      // DeepSeek: CoT counts toward max_tokens (thinking mode). API max output 384K.
      max_tokens: deepSeekModel
        ? deepSeekMaxTokens({ modelId: model.modelId, reasoningEffort, complexity })
        : 16_384,
      tools: toolsToOpenAI(mcpTools, toolListOpts),
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
        ...(projectPreamble ? [{ role: 'system', content: projectPreamble }] : []),
        ...toOpenAIMessages(sendable, {
          echoReasoningContent: needsReasoningContentEcho(model.modelId)
        })
      ]
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
  const toolBuffers = new Map<number, { id: string; name: string; args: string }>()
  const thinkingBuffers = new Map<number, TranscriptThinking>()

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
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
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
 * Parse streamed tool arguments. On failure, mark the call so the executor can
 * refuse to run with empty `{}` (which causes silent bad tool use loops).
 */
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

/**
 * Parse Retry-After header if present. Supports integer seconds and HTTP-date.
 * Returns delay in milliseconds, or null if unparseable / absent.
 */
export function parseRetryAfterHeader(headerVal: string | null | undefined): number | null {
  if (!headerVal) return null
  const trimmed = headerVal.trim()
  if (!trimmed) return null
  // Integer seconds
  const sec = Number(trimmed)
  if (Number.isFinite(sec) && sec >= 0) {
    return Math.min(30_000, Math.max(100, Math.round(sec * 1000)))
  }
  // HTTP-Date
  const parsedDate = Date.parse(trimmed)
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now()
    return Math.min(30_000, Math.max(100, diff))
  }
  return null
}

/**
 * Calculate exponential backoff delay with full jitter.
 * Prevents thundering herd problems across concurrent subagents or retrying requests.
 */
export function calculateBackoffDelay(
  attempt: number,
  isRateLimit: boolean,
  retryAfterMs?: number | null
): number {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return retryAfterMs
  }
  const base = isRateLimit ? 1600 : 700
  const maxCap = isRateLimit ? 12_000 : 6_000
  const exp = base * (1 << (Math.max(1, attempt) - 1))
  // Full jitter: random between 0 and min(maxCap, exp)
  const cappedExp = Math.min(maxCap, exp)
  const jitter = Math.random() * (cappedExp * 0.4)
  return Math.min(maxCap, Math.round(cappedExp * 0.8 + jitter))
}

/**
 * Retry only what is worth retrying on the *same* model: rate limits, 5xx and
 * network blips. A 4xx is a bad request and will fail identically forever, so it
 * propagates immediately and lets the router fail over to another model.
 */
/** Attach a transient flag so callers can skip cooling down a provider for
 *  permanent failures (bad key, unknown model, malformed request). */
export function markTransient(err: unknown, transient: boolean): Error {
  const e = err instanceof Error ? err : new Error(String(err))
  ;(e as Error & { transient?: boolean }).transient = transient
  return e
}

export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  isBrowser: boolean,
  signal: AbortSignal
): Promise<Response> {
  const payload = JSON.stringify(body)
  let lastError: Error | null = null

  // Flag set only when the error is transient (network blip, 429, 5xx).
  // 4xx and parse failures never retry — the same bytes fail forever.
  let retryable = false
  let lastRetryAfterMs: number | null = null
  let isRateLimit = false

  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (attempt > 0) {
      if (!retryable) throw lastError!
      const delayMs = calculateBackoffDelay(attempt, isRateLimit, lastRetryAfterMs)
      await new Promise((r) => setTimeout(r, delayMs))
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    }

    retryable = false
    lastRetryAfterMs = null
    isRateLimit = false

    let response: Response
    try {
      response = isBrowser
        ? await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, headers, body: payload }),
            signal
          })
        : await fetch(url, { method: 'POST', headers, body: payload, signal })
    } catch (err) {
      // Only a fetch that never produced a response is a network blip worth
      // retrying; a 4xx below is a bad request and must not be retried.
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (signal.aborted) throw err
      retryable = true
      lastError = markTransient(err, true)
      if (attempt === 2) throw lastError
      continue
    }

    if (response.ok) return response

    const status = response.status
    const text = await response.text().catch(() => '')
    const err = new Error(`HTTP ${status}: ${text.slice(0, 300)}`)
    const isDsRetry = isDeepSeekRetryableError(status, text)
    if (status === 429 || status >= 500 || isDsRetry) {
      retryable = true
      isRateLimit = status === 429 || isDsRetry
      const retryAfterHeader = response.headers?.get?.('retry-after')
      lastRetryAfterMs = parseRetryAfterHeader(retryAfterHeader)
      lastError = markTransient(err, true)
      continue
    }
    throw markTransient(err, false)
  }

  throw lastError ?? markTransient(new Error('request failed'), true)
}
