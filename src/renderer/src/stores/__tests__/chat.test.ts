// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { truncateToolResult } from '../chat'
import {
  withConversationCacheAnchors, supportsReasoningEffort, injectClaudePreamble
} from '../../agent/llm'

const blocks = (text: string): Array<Record<string, unknown>> => [{ type: 'text', text }]

describe('truncateToolResult', () => {
  it('keeps short results untouched', () => {
    expect(truncateToolResult({ content: 'short' })).toBe('short')
  })

  it('truncates long results with a note', () => {
    const out = truncateToolResult({ content: 'x'.repeat(2000) }, 100)
    expect(out.length).toBeLessThan(2000)
    expect(out).toContain('...(truncated 1900 chars)')
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
  it('accepts reasoning-capable model ids', () => {
    for (const id of ['o1', 'o4-mini', 'gpt-5', 'deepseek-reasoner', 'provider/o1-pro', 'qwq-32b']) {
      expect(supportsReasoningEffort(id), id).toBe(true)
    }
  })

  it('rejects ordinary models', () => {
    for (const id of ['gpt-4o', 'claude-sonnet-4-5', 'deepseek-chat', 'o1x']) {
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
