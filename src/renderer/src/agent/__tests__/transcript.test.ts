import { describe, it, expect } from 'vitest'
import {
  estimateTokens, compactTranscript, toClaudeMessages, toOpenAIMessages, sanitizeForSend,
  transcriptNeedsVision, stripStaleVisionPayloads,
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
    // Script-aware estimate: always positive and scales with content size.
    expect(estimateTokens(entries)).toBeGreaterThan(10)
    expect(estimateTokens([...entries, user('x'.repeat(400))])).toBeGreaterThan(
      estimateTokens(entries)
    )
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

  it('converts screenshot data URLs into image blocks', () => {
    const out = toClaudeMessages([
      { role: 'tool', toolCallId: 's1', name: 'computer_screenshot', content: 'data:image/png;base64,AAAA' }
    ])
    expect(out).toHaveLength(1)
    const blocks = out[0].content as Array<Record<string, unknown>>
    expect(blocks[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 's1',
      is_error: false
    })
    expect(blocks[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    ])
  })

  it('emits user image attachments as vision blocks after the text', () => {
    const out = toClaudeMessages([
      {
        role: 'user',
        content: 'what is this?',
        attachments: [{ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', name: 'shot.png' }]
      }
    ])
    expect(out[0].content).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    ])
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

  it('echoes reasoning_content for DeepSeek-style tool loops when enabled', () => {
    const out = toOpenAIMessages(
      [
        user('calc'),
        {
          role: 'assistant',
          content: '',
          reasoningContent: 'I should open calculator',
          toolCalls: [{ id: 't1', name: 'computer_click', arguments: { x: 1, y: 2 } }]
        }
      ],
      { echoReasoningContent: true }
    )
    expect(out[1]).toMatchObject({
      role: 'assistant',
      content: null,
      reasoning_content: 'I should open calculator',
      tool_calls: [
        {
          id: 't1',
          type: 'function',
          function: { name: 'computer_click', arguments: '{"x":1,"y":2}' }
        }
      ]
    })
  })

  it('does not echo reasoning_content by default (non-DeepSeek providers)', () => {
    const out = toOpenAIMessages([
      {
        role: 'assistant',
        content: 'hi',
        reasoningContent: 'secret chain'
      }
    ])
    expect(out[0]).toEqual({ role: 'assistant', content: 'hi' })
    expect(out[0]).not.toHaveProperty('reasoning_content')
  })

  it('converts screenshot data URLs into image_url parts', () => {
    const out = toOpenAIMessages([
      { role: 'tool', toolCallId: 's1', name: 'computer_screenshot', content: 'data:image/jpeg;base64,BBBB' }
    ])
    expect(out[0]).toEqual({
      role: 'tool',
      tool_call_id: 's1',
      content: 'Screenshot captured and attached. Coords use image space (top-left).'
    })
    expect(out[1]).toEqual({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } }]
    })
  })

  it('uses a content array when a user message has image attachments', () => {
    const out = toOpenAIMessages([
      {
        role: 'user',
        content: 'look',
        attachments: [{ kind: 'image', dataUrl: 'data:image/jpeg;base64,BBBB', name: 'x.jpg' }]
      }
    ])
    expect(out[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } }
      ]
    })
  })

  it('keeps plain strings for messages without attachments', () => {
    expect(toOpenAIMessages([user('hi')])[0].content).toBe('hi')
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

  it('trims only the trailing unanswered round, keeping earlier answered calls', () => {
    const entries: TranscriptEntry[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: {} }] },
      { role: 'tool', toolCallId: 'a', name: 'read_file', content: 'ok' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'b', name: 'edit_file', arguments: {} }] }
    ]
    const out = sanitizeForSend(entries)
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual(entries[1])
  })
})

describe('transcriptNeedsVision', () => {
  it('is false for text-only transcripts', () => {
    expect(transcriptNeedsVision([user('hello')])).toBe(false)
  })

  it('detects user image attachments', () => {
    expect(transcriptNeedsVision([{
      role: 'user',
      content: 'look',
      attachments: [{ kind: 'image', dataUrl: 'data:image/png;base64,AA' }]
    }])).toBe(true)
  })

  it('detects screenshot tool results after the last user message', () => {
    expect(transcriptNeedsVision([
      user('take a shot'),
      { role: 'tool', toolCallId: 's1', name: 'computer_screenshot', content: 'data:image/png;base64,AA' }
    ])).toBe(true)
  })

  it('ignores screenshots from earlier turns after a new text user message', () => {
    expect(transcriptNeedsVision([
      user('use computer'),
      { role: 'tool', toolCallId: 's1', name: 'computer_screenshot', content: 'data:image/png;base64,AA' },
      user('엥?')
    ])).toBe(false)
  })
})

describe('stripStaleVisionPayloads', () => {
  it('omits data URLs before the last user message', () => {
    const out = stripStaleVisionPayloads([
      user('go'),
      { role: 'tool', toolCallId: 's1', name: 'computer_screenshot', content: 'meta\ndata:image/png;base64,AAAA' },
      user('next')
    ])
    const tool = out[1] as { role: 'tool'; content: string }
    expect(tool.content).toContain('omitted')
    expect(tool.content).not.toContain('data:image')
  })
})

describe('estimateTokens image sizing', () => {
  it('does not treat screenshot base64 as millions of tokens', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(500_000)
    const n = estimateTokens([
      user('x'),
      { role: 'tool', toolCallId: 's1', name: 'computer_screenshot', content: huge }
    ])
    expect(n).toBeLessThan(5_000)
  })
})
