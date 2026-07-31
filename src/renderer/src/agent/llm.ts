/**
 * Provider wire calls: conversation cache anchors, preamble injection and the
 * streaming call itself (OpenAI-compatible and Claude formats).
 */
import { useAppStore } from '../stores/app'
import { useProviderStore } from '../stores/provider'
import { toolsToClaude, toolsToOpenAI, type ToolCall } from './tools'
import type { CallUsage } from '../stores/usage'
import type { RouteDecision } from './router'
import {
  sanitizeForSend, toClaudeMessages, toOpenAIMessages,
  type TranscriptEntry, type TranscriptThinking
} from './transcript'

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
  return /(^|\/)(o[1-4](-|$)|gpt-5|deepseek-reasoner|qwq)/i.test(modelId)
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
 usage: CallUsage
}

export interface LlmRequest {
  decision: RouteDecision
  entries: TranscriptEntry[]
  systemLayers: string[]
  projectPreamble: string
  sessionId: string
  projectId: string
  assistantMsgId: string
  signal: AbortSignal
}

export async function callLLM(req: LlmRequest): Promise<LlmResult> {
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

  // Flag set only when the error is transient (network blip, 429, 5xx).
  // 4xx and parse failures never retry — the same bytes fail forever.
  let retryable = false

  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (attempt > 0) {
      if (!retryable) throw lastError!
      await new Promise((r) => setTimeout(r, 700 * (1 << (attempt - 1))))
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    }

    retryable = false

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
      lastError = err as Error
      if (attempt === 2) throw lastError
      continue
    }

    if (response.ok) return response

    const status = response.status
    const text = await response.text().catch(() => '')
    const err = new Error(`HTTP ${status}: ${text.slice(0, 300)}`)
    if (status === 429 || status >= 500) {
      retryable = true
      lastError = err
      continue
    }
    throw err
  }

  throw lastError ?? new Error('request failed')
}
