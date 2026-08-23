import { describe, it, expect } from 'vitest'
import {
  isDeepSeekModel,
  isDeepSeekOfficialHost,
  isDeepSeekAnthropicBase,
  isDeepSeekV4Pro,
  needsReasoningContentEcho,
  mapDeepSeekReasoningEffort,
  deepSeekChatBodyExtras,
  deepSeekAnthropicBodyExtras,
  deepSeekChatCompletionsUrl,
  resolveDeepSeekAgentPolicy,
  deepSeekMaxTokens,
  deepSeekUserId,
  shouldEchoReasoningOnWire,
  parseCompatUsage,
  isDeepSeekRetryableError,
  deepSeekFimUrl,
  buildDeepSeekFimBody,
  deepSeekAgentGuidelines
} from '../deepseekCompat'
import { toOpenAIMessages } from '../transcript'

describe('deepseekCompat', () => {
  it('detects deepseek models and hosts', () => {
    expect(isDeepSeekModel('deepseek-v4-flash')).toBe(true)
    expect(isDeepSeekModel('deepseek/deepseek-v4-pro')).toBe(true)
    expect(isDeepSeekModel('gpt-4o')).toBe(false)
    expect(isDeepSeekV4Pro('deepseek-v4-pro')).toBe(true)
    expect(isDeepSeekOfficialHost('https://api.deepseek.com')).toBe(true)
    expect(isDeepSeekOfficialHost('https://api.deepseek.com/anthropic')).toBe(true)
    expect(isDeepSeekOfficialHost('https://openrouter.ai/api/v1')).toBe(false)
  })

  it('maps reasoning effort (Pro maps low→high)', () => {
    expect(mapDeepSeekReasoningEffort('low')).toBe('low')
    expect(mapDeepSeekReasoningEffort('low', 'deepseek-v4-pro')).toBe('high')
    expect(mapDeepSeekReasoningEffort('auto')).toBe('high')
    expect(mapDeepSeekReasoningEffort('medium')).toBe('high')
    expect(mapDeepSeekReasoningEffort('max')).toBe('max')
  })

  it('auto policy: simple = non-thinking (cheap/fast)', () => {
    const p = resolveDeepSeekAgentPolicy({
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'auto',
      complexity: 'simple'
    })
    expect(p.thinkingEnabled).toBe(false)
    expect(p.maxTokens).toBe(8_192)
  })

  it('auto policy: medium flash uses low effort; complex pro uses max', () => {
    const mid = resolveDeepSeekAgentPolicy({
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'auto',
      complexity: 'medium'
    })
    expect(mid.thinkingEnabled).toBe(true)
    expect(mid.reasoningEffort).toBe('low')

    const hard = resolveDeepSeekAgentPolicy({
      modelId: 'deepseek-v4-pro',
      reasoningEffort: 'auto',
      complexity: 'complex'
    })
    expect(hard.thinkingEnabled).toBe(true)
    expect(hard.reasoningEffort).toBe('max')
    expect(hard.maxTokens).toBeGreaterThanOrEqual(65_536)
  })

  it('sets temperature=1.0 in thinking mode and temperature=0.0 in non-thinking mode', () => {
    const thinkExtras = deepSeekChatBodyExtras({
      modelId: 'deepseek-v4-pro',
      thinkingEnabled: true
    })
    expect(thinkExtras.thinking).toEqual({ type: 'enabled' })
    expect(thinkExtras.temperature).toBe(1.0)

    const noThinkExtras = deepSeekChatBodyExtras({
      modelId: 'deepseek-v4-flash',
      thinkingEnabled: false
    })
    expect(noThinkExtras.thinking).toEqual({ type: 'disabled' })
    expect(noThinkExtras.temperature).toBe(0.0)
  })

  it('builds Anthropic-path extras and chat URL', () => {
    expect(isDeepSeekAnthropicBase('https://api.deepseek.com/anthropic')).toBe(true)
    expect(deepSeekChatCompletionsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/chat/completions'
    )
    expect(deepSeekChatCompletionsUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    )
    const anth = deepSeekAnthropicBodyExtras({
      modelId: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      complexity: 'medium',
      userId: 'pawn_test'
    })
    expect(anth).toMatchObject({
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
      metadata: { user_id: 'pawn_test' }
    })
  })

  it('builds DeepSeek FIM beta URL and request body', () => {
    expect(deepSeekFimUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/beta/completions')
    expect(deepSeekFimUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/beta/completions')

    const fimBody = buildDeepSeekFimBody({
      prompt: 'function add(',
      suffix: ') {\n  return a + b\n}',
      maxTokens: 1024
    })
    expect(fimBody).toEqual({
      model: 'deepseek-chat',
      prompt: 'function add(',
      suffix: ') {\n  return a + b\n}',
      max_tokens: 1024,
      temperature: 0.0,
      stop: []
    })
  })

  it('provides DeepSeek agent system prompt guidelines', () => {
    const guidelines = deepSeekAgentGuidelines()
    expect(guidelines).toContain('DeepSeek Agent')
    expect(guidelines).toContain('JSON')
  })

  it('detects retryable DeepSeek errors', () => {
    expect(isDeepSeekRetryableError(429, '')).toBe(true)
    expect(isDeepSeekRetryableError(200, 'insufficient_system_resource')).toBe(true)
    expect(isDeepSeekRetryableError(400, 'bad request')).toBe(false)
  })

  it('builds thinking body extras for DeepSeek only', () => {
    expect(deepSeekChatBodyExtras({ modelId: 'gpt-4o' })).toEqual({})
    const body = deepSeekChatBodyExtras({
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'high'
    })
    expect(body).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      temperature: 1.0
    })
  })

  it('can disable thinking via policy (simple auto)', () => {
    const body = deepSeekChatBodyExtras({
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'auto',
      complexity: 'simple'
    })
    expect(body).toEqual({ thinking: { type: 'disabled' }, temperature: 0.0 })
  })

  it('sizes max_tokens by policy', () => {
    expect(
      deepSeekMaxTokens({ modelId: 'deepseek-v4-flash', reasoningEffort: 'auto', complexity: 'simple' })
    ).toBe(8_192)
    expect(deepSeekMaxTokens({ modelId: 'deepseek-v4-pro', reasoningEffort: 'max' })).toBe(65_536)
    expect(
      deepSeekMaxTokens({ modelId: 'deepseek-v4-pro', reasoningEffort: 'auto', complexity: 'complex' })
    ).toBe(98_304)
  })

  it('sanitizes user_id', () => {
    expect(deepSeekUserId('proj/abc!', 'sess')).toBe('pawn_proj_abc_')
    expect(deepSeekUserId('__general__', 's1')).toBe('pawn_s1')
  })

  it('requires reasoning_content echo for MiMo thinking tool loops', () => {
    expect(needsReasoningContentEcho('mimo-v2.5-pro')).toBe(true)
    expect(needsReasoningContentEcho('xiaomi/mimo-v2.5')).toBe(true)
    expect(needsReasoningContentEcho('gpt-4o')).toBe(false)
  })

  it('echoes reasoning_content on multi-turn tool conversations', () => {
    expect(shouldEchoReasoningOnWire('deepseek-v4-flash', 'thought', true)).toBe(true)
    expect(shouldEchoReasoningOnWire('deepseek-v4-flash', null, true)).toBe(true)
    expect(shouldEchoReasoningOnWire('deepseek-v4-flash', null, false)).toBe(false)

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

  it('parses DeepSeek disk-cache usage fields', () => {
    const u = parseCompatUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
      completion_tokens_details: { reasoning_tokens: 30 }
    })
    expect(u.cacheReadTokens).toBe(800)
    expect(u.inputTokens).toBe(200)
    expect(u.outputTokens).toBe(50)
    expect(u.reasoningTokens).toBe(30)
  })

  it('parses OpenAI-style cached_tokens usage', () => {
    const u = parseCompatUsage({
      prompt_tokens: 500,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 400 }
    })
    expect(u.cacheReadTokens).toBe(400)
    expect(u.inputTokens).toBe(100)
  })
})
