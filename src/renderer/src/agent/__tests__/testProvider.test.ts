import { describe, it, expect } from 'vitest'
import {
  buildTestRequestBody,
  pickTestModelId,
  providerChatUrl,
  summarizeProviderError
} from '../testProvider'

describe('testProvider', () => {
  it('picks an enabled model for the provider instead of hardcoded gpt-4o-mini', () => {
    const id = pickTestModelId(
      'p1',
      [
        { providerId: 'p1', modelId: 'deepseek-v4-flash', enabled: true },
        { providerId: 'p1', modelId: 'deepseek-v4-pro', enabled: false },
        { providerId: 'p2', modelId: 'gpt-5.6-luna', enabled: true }
      ],
      'openai'
    )
    expect(id).toBe('deepseek-v4-flash')
  })

  it('falls back to first attached model when none enabled', () => {
    expect(
      pickTestModelId(
        'p1',
        [{ providerId: 'p1', modelId: 'mimo-v2.5-pro', enabled: false }],
        'openai'
      )
    ).toBe('mimo-v2.5-pro')
  })

  it('builds chat URL without double slashes', () => {
    expect(providerChatUrl({ apiFormat: 'openai', baseUrl: 'https://opencode.ai/zen/go/v1/' })).toBe(
      'https://opencode.ai/zen/go/v1/chat/completions'
    )
    expect(providerChatUrl({ apiFormat: 'claude', baseUrl: 'https://api.xiaomimimo.com/anthropic' })).toBe(
      'https://api.xiaomimimo.com/anthropic/messages'
    )
  })

  it('puts the selected model into the request body', () => {
    expect(buildTestRequestBody('openai', 'deepseek-v4-flash').model).toBe('deepseek-v4-flash')
    expect(buildTestRequestBody('claude', 'minimax-m3').model).toBe('minimax-m3')
  })

  it('summarizes provider JSON errors', () => {
    expect(
      summarizeProviderError(
        400,
        JSON.stringify({ type: 'error', error: { type: 'ModelError', message: 'Model gpt-4o-mini is not supported' } })
      )
    ).toContain('400')
    expect(
      summarizeProviderError(
        400,
        JSON.stringify({ type: 'error', error: { type: 'ModelError', message: 'Model gpt-4o-mini is not supported' } })
      )
    ).toMatch(/not supported/i)

    expect(
      summarizeProviderError(401, JSON.stringify({ error: { message: 'Invalid API key.', type: 'AuthError' } }))
    ).toMatch(/Invalid API key/i)
  })
})
