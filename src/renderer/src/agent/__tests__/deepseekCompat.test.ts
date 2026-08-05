import { describe, it, expect } from 'vitest'
import {
  isDeepSeekModel,
  needsReasoningContentEcho,
  mapDeepSeekReasoningEffort,
  deepSeekChatBodyExtras,
  shouldEchoReasoningOnWire
} from '../deepseekCompat'
import { toOpenAIMessages } from '../transcript'

describe('deepseekCompat', () => {
  it('detects deepseek models', () => {
    expect(isDeepSeekModel('deepseek-v4-flash')).toBe(true)
    expect(isDeepSeekModel('deepseek/deepseek-v4-pro')).toBe(true)
    expect(isDeepSeekModel('gpt-4o')).toBe(false)
  })

  it('maps reasoning effort', () => {
    expect(mapDeepSeekReasoningEffort('low')).toBe('low')
    expect(mapDeepSeekReasoningEffort('auto')).toBe('high')
    expect(mapDeepSeekReasoningEffort('medium')).toBe('high')
    expect(mapDeepSeekReasoningEffort('high')).toBe('high')
    expect(mapDeepSeekReasoningEffort('max')).toBe('max')
  })

  it('builds thinking body extras for DeepSeek only', () => {
    expect(deepSeekChatBodyExtras({ modelId: 'gpt-4o' })).toEqual({})
    const body = deepSeekChatBodyExtras({
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'high'
    })
    expect(body).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high'
    })
  })

  it('can disable thinking', () => {
    expect(
      deepSeekChatBodyExtras({
        modelId: 'deepseek-v4-pro',
        thinkingEnabled: false
      })
    ).toEqual({ thinking: { type: 'disabled' } })
  })

  it('echoes reasoning_content on the wire for tool loops', () => {
    expect(shouldEchoReasoningOnWire('deepseek-v4-flash', 'chain')).toBe(true)
    expect(shouldEchoReasoningOnWire('deepseek-v4-flash', '', true)).toBe(true)
    expect(shouldEchoReasoningOnWire('gpt-4o', 'chain')).toBe(false)

    const msgs = toOpenAIMessages(
      [
        {
          role: 'assistant',
          content: '',
          reasoningContent: 'plan tool use',
          toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: '/a' } }]
        }
      ],
      { echoReasoningContent: needsReasoningContentEcho('deepseek-v4-flash') }
    )
    expect(msgs[0].reasoning_content).toBe('plan tool use')
    expect(msgs[0].tool_calls).toBeDefined()
  })

  it('sends empty reasoning_content for tool turns missing CoT (avoids 400)', () => {
    const msgs = toOpenAIMessages(
      [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'computer_click', arguments: { x: 1, y: 2 } }]
        }
      ],
      { echoReasoningContent: true }
    )
    expect(msgs[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: '',
      tool_calls: expect.any(Array)
    })
  })
})
