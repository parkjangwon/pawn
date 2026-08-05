// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { truncateToolResult, toolCallSignature, ToolLoopCounter } from '../chat'
import {
  withConversationCacheAnchors, supportsReasoningEffort, injectClaudePreamble
} from '../../agent/llm'

const blocks = (text: string): Array<Record<string, unknown>> => [{ type: 'text', text }]
const call = (name: string, arguments_: Record<string, unknown>) => ({ id: `${name}-id`, name, arguments: arguments_ })

describe('truncateToolResult', () => {
  it('keeps short results untouched', () => {
    expect(truncateToolResult({ content: 'short' })).toBe('short')
  })

  it('truncates long results with a note', () => {
    const out = truncateToolResult({ content: 'x'.repeat(2000) }, 100)
    expect(out.length).toBeLessThan(2000)
    expect(out).toContain('...(truncated 1900 chars')
  })
})

describe('toolCallSignature', () => {
  it('is insensitive to call order', () => {
    const a = [call('read_file', { path: '/a' }), call('list_dir', { path: '/b' })]
    const b = [call('list_dir', { path: '/b' }), call('read_file', { path: '/a' })]
    expect(toolCallSignature(a)).toBe(toolCallSignature(b))
  })

  it('is insensitive to argument key order', () => {
    const a = call('write_file', { path: '/a', content: 'x' })
    const b = call('write_file', { content: 'x', path: '/a' })
    expect(toolCallSignature([a])).toBe(toolCallSignature([b]))
  })

  it('differs when arguments differ', () => {
    const a = call('read_file', { path: '/a' })
    const b = call('read_file', { path: '/b' })
    expect(toolCallSignature([a])).not.toBe(toolCallSignature([b]))
  })
})

describe('ToolLoopCounter', () => {
  it('ignores rounds without tool calls', () => {
    const counter = new ToolLoopCounter(3)
    expect(counter.record([])).toBe(false)
    expect(counter.record([])).toBe(false)
  })

  it('fires after the limit of consecutive identical calls', () => {
    const counter = new ToolLoopCounter(3)
    const calls = [call('read_file', { path: '/a' })]
    expect(counter.record(calls)).toBe(false)
    expect(counter.record(calls)).toBe(false)
    expect(counter.record(calls)).toBe(true)
  })

  it('resets when the calls change', () => {
    const counter = new ToolLoopCounter(3)
    expect(counter.record([call('read_file', { path: '/a' })])).toBe(false)
    expect(counter.record([call('read_file', { path: '/a' })])).toBe(false)
    expect(counter.record([call('read_file', { path: '/b' })])).toBe(false)
    expect(counter.record([call('read_file', { path: '/b' })])).toBe(false)
    expect(counter.record([call('read_file', { path: '/b' })])).toBe(true)
  })

  it('resets when a round has no tool calls', () => {
    const counter = new ToolLoopCounter(2)
    expect(counter.record([call('read_file', { path: '/a' })])).toBe(false)
    expect(counter.record([])).toBe(false)
    expect(counter.record([call('read_file', { path: '/a' })])).toBe(false)
    expect(counter.record([call('read_file', { path: '/a' })])).toBe(true)
  })
})

describe('withConversationCacheAnchors', () => {
  it('returns empty arrays unchanged', () => {
    expect(withConversationCacheAnchors([])).toEqual([])
  })

  it('anchors the last message and the previous user turn', () => {
    const messages = [
      { role: 'user', content: blocks('first') },
      { role: 'assistant', content: blocks('reply') },
      { role: 'user', content: blocks('second') }
    ]
    const out = withConversationCacheAnchors(messages)
    expect((out[0].content as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: 'ephemeral' })
    expect((out[2].content as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: 'ephemeral' })
    // The middle message must stay untouched.
    expect(out[1].content).toEqual(blocks('reply'))
  })

  it('anchors the first message when there is no previous user turn', () => {
    const messages = [
      { role: 'assistant', content: blocks('a') },
      { role: 'assistant', content: blocks('b') }
    ]
    const out = withConversationCacheAnchors(messages)
    expect((out[0].content as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: 'ephemeral' })
    expect((out[1].content as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('only annotates block-array content and never mutates the input', () => {
    const messages = [
      { role: 'user', content: 'plain string' },
      { role: 'user', content: blocks('x') }
    ]
    const snapshot = JSON.parse(JSON.stringify(messages))
    withConversationCacheAnchors(messages)
    expect(messages).toEqual(snapshot)

    const out = withConversationCacheAnchors(messages)
    expect(out[0].content).toBe('plain string')
    expect((out[1].content as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: 'ephemeral' })
  })
})

describe('supportsReasoningEffort', () => {
  it('accepts OpenAI-style reasoning_effort model ids', () => {
    for (const id of ['o1', 'o4-mini', 'gpt-5', 'provider/o1-pro', 'qwq-32b']) {
      expect(supportsReasoningEffort(id), id).toBe(true)
    }
  })

  it('rejects ordinary models and DeepSeek (uses thinking body extras instead)', () => {
    for (const id of ['gpt-4o', 'claude-sonnet-4-5', 'deepseek-chat', 'deepseek-v4-flash', 'deepseek-reasoner', 'o1x']) {
      expect(supportsReasoningEffort(id), id).toBe(false)
    }
  })
})

describe('injectClaudePreamble', () => {
  it('returns messages unchanged without a preamble', () => {
    const messages = [{ role: 'user', content: blocks('hi') }]
    expect(injectClaudePreamble(messages, '')).toBe(messages)
  })

  it('prepends the preamble into the first user block list', () => {
    const out = injectClaudePreamble([{ role: 'user', content: blocks('hi') }], '--- cwd ---')
    expect(out[0].content).toEqual([
      { type: 'text', text: '--- cwd ---' },
      { type: 'text', text: 'hi' }
    ])
  })

  it('adds a standalone preamble user message when the first entry is not a user', () => {
    const out = injectClaudePreamble([{ role: 'assistant', content: blocks('r') }], '--- cwd ---')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '--- cwd ---' }] })
  })
})
