import { describe, it, expect } from 'vitest'
import {
  estimateTokens, compactTranscript, toClaudeMessages, toOpenAIMessages, sanitizeForSend,
  type TranscriptEntry
} from '../transcript'

const user = (content: string): TranscriptEntry => ({ role: 'user', content })

describe('estimateTokens', () => {
  it('counts characters across roles, tool calls and thinking blocks', () => {
    const entries: TranscriptEntry[] = [
      user('hello'),
      {
        role: 'assistant',
        content: 'world',
        toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: '/a' } }],
        thinking: [{ type: 'thinking', thinking: 'pondering' }]
      },
      { role: 'tool', toolCallId: 't1', name: 'read_file', content: 'contents' }
    ]
    const chars =
      5 + // hello
      5 + // world
      'read_file'.length + JSON.stringify({ path: '/a' }).length +
      'pondering'.length +
      'contents'.length
    expect(estimateTokens(entries)).toBe(Math.ceil(chars / 3.6))
  })
})

describe('compactTranscript', () => {
  it('returns entries untouched when under the limit', () => {
    const entries = [user('a'), user('b')]
    expect(compactTranscript(entries, 30)).toBe(entries)
  })

  it('replaces old entries with a summary and never splits tool results', () => {
    const entries: TranscriptEntry[] = [
      user('first ask'),
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 't1', name: 'edit_file', arguments: { path: '/x.ts' } }] },
      { role: 'tool', toolCallId: 't1', name: 'edit_file', content: 'small result' },
      user('recent ask'),
      { role: 'assistant', content: 'final' }
    ]
    const out = compactTranscript(entries, 2)
    expect(out[0].role).toBe('summary')
    expect(out[1]).toEqual(user('recent ask'))
    expect(out[2]).toEqual({ role: 'assistant', content: 'final' })

    const summary = out[0].content
    expect(summary).toContain('first ask')
    expect(summary).toContain('edit_file')
    expect(summary).toContain('/x.ts')
    expect(summary).toContain('small result')
  })

  it('preserves error results even when large', () => {
    const entries: TranscriptEntry[] = [
      { role: 'assistant', content: 'run', toolCalls: [{ id: 't1', name: 'shell_exec', arguments: {} }] },
      { role: 'tool', toolCallId: 't1', name: 'shell_exec', content: 'boom'.repeat(1000), isError: true },
      user('next')
    ]
    const out = compactTranscript(entries, 2)
    expect(out[0].content).toContain('[shell_exec ERROR]')
  })
})

describe('toClaudeMessages', () => {
  it('emits user content as block arrays', () => {
    const out = toClaudeMessages([user('hi')])
    expect(out).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
  })

  it('orders thinking blocks before text and tool_use', () => {
    const out = toClaudeMessages([
      {
        role: 'assistant',
        content: 'answer',
        thinking: [{ type: 'thinking', thinking: 'reasons', signature: 'sig-1' }],
        toolCalls: [{ id: 't1', name: 'grep_search', arguments: { q: 'x' } }]
      }
    ])
    expect(out[0].content).toEqual([
      { type: 'thinking', thinking: 'reasons', signature: 'sig-1' },
      { type: 'text', text: 'answer' },
      { type: 'tool_use', id: 't1', name: 'grep_search', input: { q: 'x' } }
    ])
  })

  it('merges consecutive tool results into one user message', () => {
    const out = toClaudeMessages([
      { role: 'tool', toolCallId: 'a', name: 'read_file', content: 'one' },
      { role: 'tool', toolCallId: 'b', name: 'read_file', content: 'two' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'one', is_error: false },
      { type: 'tool_result', tool_use_id: 'b', content: 'two', is_error: false }
    ])
  })

  it('skips empty assistant turns', () => {
    expect(toClaudeMessages([{ role: 'assistant', content: '' }])).toEqual([])
  })
})

describe('toOpenAIMessages', () => {
  it('keeps user content as plain strings and serializes tool calls', () => {
    const out = toOpenAIMessages([
      user('hi'),
      { role: 'assistant', content: 'lets see', toolCalls: [{ id: 't1', name: 'list_dir', arguments: { path: '/p' } }] }
    ])
    expect(out[1]).toEqual({
      role: 'assistant',
      content: 'lets see',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"/p"}' } }]
    })
  })

  it('drops empty assistant turns without tool calls', () => {
    expect(toOpenAIMessages([{ role: 'assistant', content: '' }])).toEqual([])
  })
})

describe('sanitizeForSend', () => {
  it('trims a trailing assistant tool-call turn that was never answered', () => {
    const entries: TranscriptEntry[] = [
      user('go'),
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'edit_file', arguments: {} }] }
    ]
    expect(sanitizeForSend(entries)).toEqual([user('go')])
  })

  it('keeps answered tool calls', () => {
    const entries: TranscriptEntry[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'edit_file', arguments: {} }] },
      { role: 'tool', toolCallId: 't1', name: 'edit_file', content: 'ok' }
    ]
    expect(sanitizeForSend(entries)).toEqual(entries)
  })
})
