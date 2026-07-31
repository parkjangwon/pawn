// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { callLLM, type LlmRequest } from '../chat'
import { useAppStore } from '../app'
import type { Provider, ModelEntry } from '../../types/provider'

const provider: Provider = {
  id: 'openai', name: 'OpenAI', apiFormat: 'openai', authMethod: 'api-key',
  baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', enabled: true
}

const model: ModelEntry = {
  id: 'openai:gpt-4o', providerId: 'openai', modelId: 'gpt-4o', label: 'GPT-4o', tier: 'mid', enabled: true,
  pricing: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 6.25 }
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(body, { status: 200 })
}

function makeRequest(apiFormat: 'openai' | 'claude'): LlmRequest {
  return {
    decision: {
      provider: { ...provider, apiFormat },
      model,
      key: 'openai:gpt-4o',
      tier: 'mid',
      reason: 'auto: medium'
    },
    entries: [{ role: 'user', content: 'hello' }],
    systemLayers: ['base prompt'],
    projectPreamble: '--- cwd ---',
    sessionId: 's1',
    projectId: 'p1',
    assistantMsgId: 'asst-1',
    signal: new AbortController().signal
  }
}

beforeEach(() => {
  useAppStore.setState({
    projects: [{ id: 'p1', name: 'P', paths: ['/p'], sessions: [{ id: 's1', title: 'S', path: '/p', createdAt: 1, messages: [] }] }],
    activeProjectId: 'p1',
    activeSessionId: 's1'
  })
  vi.stubGlobal('fetch', vi.fn())
  ;(window as any).api = {
    platform: 'electron',
    db: { updateMessageContent: vi.fn() }
  }
})

describe('callLLM (OpenAI stream)', () => {
  it('accumulates text, reasoning and tool calls, and reads usage', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(streamResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\":\\"/a\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\n',
      'data: {"usage":{"prompt_tokens":120,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":100}}}\n\n',
      'data: [DONE]\n\n'
    ]))

    const result = await callLLM(makeRequest('openai'))
    expect(result.text).toBe('Hello')
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'read_file', arguments: { path: '/a' } }])
    expect(result.usage.inputTokens).toBe(20)
    expect(result.usage.cacheReadTokens).toBe(100)
    expect(result.usage.outputTokens).toBe(8)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages[0].content).toBe('base prompt')
    expect(body.messages[1].content).toBe('--- cwd ---')
    expect(body.model).toBe('gpt-4o')
  })

  it('does not send reasoning_effort to non-reasoning models', async () => {
    vi.mocked(fetch).mockResolvedValue(streamResponse(['data: [DONE]\n\n']))
    await callLLM(makeRequest('openai'))
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('streams updates into the assistant message', async () => {
    useAppStore.setState({
      projects: [{
        id: 'p1', name: 'P', paths: ['/p'],
        sessions: [{ id: 's1', title: 'S', path: '/p', createdAt: 1, messages: [{ id: 'asst-1', role: 'assistant', content: '', createdAt: 1 }] }]
      }]
    })
    vi.mocked(fetch).mockResolvedValue(streamResponse([
      'data: {"choices":[{"delta":{"content":"one"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" two"}}]}\n\n',
      'data: [DONE]\n\n'
    ]))
    await callLLM(makeRequest('openai'))
    const msg = useAppStore.getState().projects[0].sessions[0].messages[0]
    expect(msg.content).toBe('one two')
  })
})

describe('callLLM (Claude stream)', () => {
  it('parses message_start usage, thinking blocks and tool_use', async () => {
    vi.mocked(fetch).mockResolvedValue(streamResponse([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":200,"output_tokens":1,"cache_read_input_tokens":150,"cache_creation_input_tokens":30}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"ponder"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"grep_search","input":{}}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"x\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":1}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":99}}\n\n',
      'data: {"type":"message_stop"}\n\n'
    ]))

    const result = await callLLM(makeRequest('claude'))
    expect(result.usage.inputTokens).toBe(200)
    expect(result.usage.cacheReadTokens).toBe(150)
    expect(result.usage.cacheWriteTokens).toBe(30)
    expect(result.usage.outputTokens).toBe(99)
    expect(result.thinking).toEqual([{ type: 'thinking', thinking: 'ponder', signature: 'sig-1' }])
    expect(result.toolCalls).toEqual([{ id: 't1', name: 'grep_search', arguments: { q: 'x' } }])
  })

  it('throws on a streamed error event', async () => {
    vi.mocked(fetch).mockResolvedValue(streamResponse([
      'data: {"type":"error","error":{"message":"overloaded"}}\n\n'
    ]))
    await expect(callLLM(makeRequest('claude'))).rejects.toThrow('overloaded')
  })
})
