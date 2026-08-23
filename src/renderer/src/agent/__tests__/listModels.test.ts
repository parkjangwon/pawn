import { describe, it, expect } from 'vitest'
import {
  authHeadersForProvider,
  humanizeModelId,
  isLikelyChatModel,
  isOpenRouterProvider,
  isXiaomiMimoHost,
  mergeRemoteModels,
  modelsListUrl
} from '../listModels'
import type { ModelEntry } from '../../types/provider'

describe('listModels helpers', () => {
  it('builds models list URL from base', () => {
    expect(modelsListUrl('https://opencode.ai/zen/go/v1')).toBe('https://opencode.ai/zen/go/v1/models')
    expect(modelsListUrl('https://api.commandcode.ai/provider/v1/')).toBe(
      'https://api.commandcode.ai/provider/v1/models'
    )
    expect(modelsListUrl('https://x/v1/models')).toBe('https://x/v1/models')
  })

  it('filters non-chat model ids', () => {
    expect(isLikelyChatModel('mimo-v2.5-pro')).toBe(true)
    expect(isLikelyChatModel('deepseek-v4-flash')).toBe(true)
    expect(isLikelyChatModel('mimo-v2.5-tts')).toBe(false)
    expect(isLikelyChatModel('mimo-v2.5-asr')).toBe(false)
    expect(isLikelyChatModel('text-embedding-3-small')).toBe(false)
    expect(isLikelyChatModel('whisper-1')).toBe(false)
  })

  it('humanizes ids', () => {
    expect(humanizeModelId('deepseek/deepseek-v4-flash')).toMatch(/Deepseek/i)
    expect(humanizeModelId('glm-5.2')).toBeTruthy()
  })

  it('detects Xiaomi MiMo hosts and dual auth headers', () => {
    expect(isXiaomiMimoHost('https://api.xiaomimimo.com/v1')).toBe(true)
    expect(isXiaomiMimoHost('https://token-plan-cn.xiaomimimo.com/v1')).toBe(true)
    expect(isXiaomiMimoHost('https://api.openai.com/v1')).toBe(false)

    const openAi = authHeadersForProvider({
      apiFormat: 'openai',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      apiKey: 'sk-test'
    })
    expect(openAi.Authorization).toBe('Bearer sk-test')
    expect(openAi['api-key']).toBe('sk-test')

    const claude = authHeadersForProvider({
      apiFormat: 'claude',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant'
    })
    expect(claude['x-api-key']).toBe('sk-ant')
    expect(claude['anthropic-version']).toBe('2023-06-01')
  })

  it('merges remote models without wiping enables or user pricing', () => {
    const existing: ModelEntry[] = [
      {
        id: 'local-1',
        providerId: 'p1',
        modelId: 'deepseek-v4-flash',
        label: 'My Flash',
        tier: 'mid',
        enabled: false,
        pricing: { input: 9, output: 9, cacheRead: 1, cacheWrite: 1 }
      },
      {
        id: 'other',
        providerId: 'p2',
        modelId: 'gpt-5.6-luna',
        label: 'Luna',
        tier: 'low',
        enabled: true
      }
    ]

    const result = mergeRemoteModels(existing, 'p1', [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1_000_000 },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextWindow: 1_000_000 },
      { id: 'brand-new', label: 'Brand New' }
    ])

    expect(result.added).toBe(2)
    expect(result.remoteCount).toBe(3)
    const p1 = result.models.filter((m) => m.providerId === 'p1')
    expect(p1.map((m) => m.modelId).sort()).toEqual(
      ['brand-new', 'deepseek-v4-flash', 'deepseek-v4-pro'].sort()
    )
    const flash = p1.find((m) => m.modelId === 'deepseek-v4-flash')!
    expect(flash.enabled).toBe(false)
    expect(flash.label).toBe('My Flash')
    expect(flash.pricing?.input).toBe(9)
    expect(flash.contextWindow).toBe(1_000_000)
    expect(result.models.some((m) => m.providerId === 'p2')).toBe(true)
  })

  it('keeps local-only models when API omits them', () => {
    const existing: ModelEntry[] = [
      {
        id: 'keep',
        providerId: 'p1',
        modelId: 'custom-local',
        label: 'Custom',
        tier: 'mid',
        enabled: true
      }
    ]
    const result = mergeRemoteModels(existing, 'p1', [
      { id: 'remote-only', label: 'Remote' }
    ])
    expect(result.models.map((m) => m.modelId).sort()).toEqual(['custom-local', 'remote-only'])
  })

  it('detects OpenRouter provider correctly', () => {
    expect(isOpenRouterProvider({ baseUrl: 'https://openrouter.ai/api/v1' })).toBe(true)
    expect(isOpenRouterProvider({ name: 'OpenRouter' })).toBe(true)
    expect(isOpenRouterProvider({ id: 'openrouter' })).toBe(true)
    expect(isOpenRouterProvider({ baseUrl: 'https://api.openai.com/v1', name: 'OpenAI', id: 'openai-1' })).toBe(false)
  })
})
