import { describe, expect, it } from 'vitest'
import {
  AntigravityStream,
  ResponsesStream,
  chatCompletionsToAntigravity,
  chatCompletionsToResponses,
  rewriteSubscriptionCall,
  withClaudeOauthHeaders,
  type WireSink
} from '../subscriptionWire'

function sink(): WireSink & { texts: string[]; tools: string[]; errors: string[] } {
  const texts: string[] = []
  const tools: string[] = []
  const errors: string[] = []
  return {
    texts,
    tools,
    errors,
    text: (d) => texts.push(d),
    reasoning: () => {},
    tool: (call) => tools.push(`${call.name}:${call.id}`),
    usage: () => {},
    error: (message) => errors.push(message)
  }
}

describe('subscription wire', () => {
  it('turns chat messages into a Codex responses request', () => {
    const body = chatCompletionsToResponses({
      model: 'gpt-5.6-terra',
      stream: false,
      max_tokens: 32,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }]
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'ok' }
      ],
      tools: [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object' } } }]
    })
    expect(body.instructions).toBe('be brief')
    expect(body.stream).toBe(false)
    expect(body.tools).toEqual([{ type: 'function', name: 'read_file', description: 'read', parameters: { type: 'object' } }])
    const input = body.input as Array<Record<string, unknown>>
    expect(input.map((item) => item.type || item.role)).toEqual(['user', 'function_call', 'function_call_output'])
    expect(input[1]).toMatchObject({ call_id: 'call_1', name: 'read_file' })
  })

  it('points a signed-in ChatGPT call at the responses endpoint', () => {
    const wired = rewriteSubscriptionCall({
      provider: {
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        subscription: { kind: 'chatgpt', accountId: 'acct' }
      },
      url: 'https://chatgpt.com/backend-api/codex/chat/completions',
      headers: { Authorization: 'Bearer tok' },
      body: { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'ping' }] },
      stream: true
    })
    expect(wired.url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(wired.streamKind).toBe('responses')
    expect(wired.headers['ChatGPT-Account-ID']).toBe('acct')
    expect(wired.headers.originator).toBe('pawn')
    expect(wired.body.stream).toBe(true)
  })

  it('swaps a Claude API key for the oauth bearer header', () => {
    const headers = withClaudeOauthHeaders({ 'x-api-key': 'oat', 'anthropic-beta': 'computer-use' }, 'claude')
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer oat')
    expect(headers['anthropic-beta']).toBe('computer-use,oauth-2025-04-20')
  })

  it('maps tool results onto Cloud Code contents', () => {
    const body = chatCompletionsToAntigravity({
      model: 'gemini-3.5-flash',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"a"}' } }]
        },
        { role: 'tool', tool_call_id: 'c1', content: 'file' }
      ]
    }, 'proj')
    expect(body.project).toBe('proj')
    const request = body.request as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>; systemInstruction?: unknown }
    expect(request.systemInstruction).toBeTruthy()
    expect(request.contents.map((row) => row.role)).toEqual(['user', 'model', 'user'])
    expect(request.contents[1].parts[0]).toMatchObject({ functionCall: { name: 'read_file', id: 'c1' } })
    expect(request.contents[2].parts[0]).toMatchObject({ functionResponse: { name: 'read_file', id: 'c1' } })
  })

  it('folds responses and antigravity stream events into text and one tool call', () => {
    const responses = sink()
    const stream = new ResponsesStream(responses)
    stream.consume({ type: 'response.output_text.delta', delta: 'he' })
    stream.consume({ type: 'response.output_text.done', text: 'hello' })
    stream.consume({
      type: 'response.output_item.added',
      item: { type: 'function_call', id: 'item_1', call_id: 'call_1', name: 'read_file' }
    })
    stream.consume({ type: 'response.function_call_arguments.done', item_id: 'item_1', arguments: '{"path":"a"}' })
    expect(responses.texts.join('')).toBe('hello')
    expect(responses.tools).toEqual(['read_file:call_1'])

    const gravity = sink()
    const ag = new AntigravityStream(gravity)
    ag.consume({ response: { candidates: [{ content: { parts: [{ text: 'ab' }] } }] } })
    ag.consume({
      response: {
        candidates: [{
          content: { parts: [{ text: 'abcd' }, { functionCall: { name: 'read_file', id: 'f1', args: { path: 'a' } } }] }
        }]
      }
    })
    ag.consume({
      response: {
        candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', id: 'f1', args: { path: 'a' } } }] } }]
      }
    })
    expect(gravity.texts.join('')).toBe('abcd')
    expect(gravity.tools).toEqual(['read_file:f1'])
  })
})
