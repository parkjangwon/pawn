// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProviderStore } from '../provider'
import type { ModelEntry, Provider } from '../../types/provider'

const configMock = {
  load: vi.fn(),
  save: vi.fn()
}

const provider = (id: string, name = id): Provider => ({
  id, name, apiFormat: 'openai', authMethod: 'api-key', baseUrl: 'https://api.example.com', enabled: true
})

const model = (id: string, providerId: string, modelId: string, tier: ModelEntry['tier']): ModelEntry => ({
  id, providerId, modelId, label: modelId, tier, enabled: true
})

beforeEach(() => {
  ;(window as any).api = { config: configMock }
  useProviderStore.setState({
    providers: [],
    models: [],
    routingMode: 'auto',
    activeModelId: null,
    defaultSendMode: 'queue',
    permissionMode: 'ask',
    reasoningEffort: 'auto',
    initialized: false
  })
  configMock.load.mockReset()
  configMock.save.mockReset()
})

describe('init', () => {
  it('hydrates providers, models and settings', async () => {
    configMock.load.mockResolvedValue({
      providers: [provider('p1')],
      models: [model('m1', 'p1', 'gpt-4o', 'mid')],
      settings: { routingMode: 'manual', activeModelId: 'm1', defaultSendMode: 'steer', permissionMode: 'yolo', reasoningEffort: 'high' }
    })
    await useProviderStore.getState().init()
    const s = useProviderStore.getState()
    expect(s.initialized).toBe(true)
    expect(s.providers).toHaveLength(1)
    expect(s.routingMode).toBe('manual')
    expect(s.activeModelId).toBe('m1')
    expect(s.permissionMode).toBe('yolo')
  })

  it('backfills pricing for known models saved without it', async () => {
    configMock.load.mockResolvedValue({
      providers: [provider('p1')],
      models: [model('m1', 'p1', 'gpt-4o', 'mid')]
    })
    await useProviderStore.getState().init()
    const hydrated = useProviderStore.getState().models[0]
    expect(hydrated.pricing).toBeDefined()
    expect(hydrated.pricing!.input).toBeGreaterThan(0)
    expect(hydrated.contextWindow).toBeGreaterThan(0)
  })

  it('runs init only once', async () => {
    configMock.load.mockResolvedValue({ providers: [], models: [] })
    await useProviderStore.getState().init()
    await useProviderStore.getState().init()
    expect(configMock.load).toHaveBeenCalledTimes(1)
  })
})

describe('provider actions', () => {
  it('adds, updates and removes providers, dropping their models', () => {
    useProviderStore.getState().addProvider(provider('p1'))
    useProviderStore.getState().addModel(model('m1', 'p1', 'x', 'low'))
    expect(useProviderStore.getState().providers).toHaveLength(1)

    useProviderStore.getState().updateProvider('p1', { baseUrl: 'https://new.example.com' })
    expect(useProviderStore.getState().providers[0].baseUrl).toBe('https://new.example.com')

    useProviderStore.getState().removeProvider('p1')
    expect(useProviderStore.getState().providers).toHaveLength(0)
    expect(useProviderStore.getState().models).toHaveLength(0)
  })

  it('persists state to config on every mutation', () => {
    useProviderStore.getState().addProvider(provider('p1'))
    expect(configMock.save).toHaveBeenCalledWith(
      expect.objectContaining({ providers: [expect.objectContaining({ id: 'p1' })] })
    )
  })
})

describe('model actions', () => {
  it('adds, updates and removes models', () => {
    useProviderStore.getState().addModel(model('m1', 'p1', 'gpt-4o', 'mid'))
    useProviderStore.getState().updateModel('m1', { tier: 'high' })
    expect(useProviderStore.getState().models[0].tier).toBe('high')

    useProviderStore.getState().removeModel('m1')
    expect(useProviderStore.getState().models).toHaveLength(0)
  })
})

describe('settings actions', () => {
  it('switches to manual routing when pinning a model', () => {
    useProviderStore.getState().addModel(model('m1', 'p1', 'gpt-4o', 'mid'))
    useProviderStore.getState().setActiveModel('m1')
    expect(useProviderStore.getState().activeModelId).toBe('m1')
    expect(useProviderStore.getState().routingMode).toBe('manual')

    // Clearing the pin keeps the current mode; it does not force auto.
    useProviderStore.getState().setActiveModel(null)
    expect(useProviderStore.getState().routingMode).toBe('manual')
  })

  it('updates send mode, permission mode and reasoning effort', () => {
    useProviderStore.getState().setDefaultSendMode('steer')
    useProviderStore.getState().setPermissionMode('yolo')
    useProviderStore.getState().setReasoningEffort('medium')
    useProviderStore.getState().setRoutingMode('manual')

    const s = useProviderStore.getState()
    expect(s.defaultSendMode).toBe('steer')
    expect(s.permissionMode).toBe('yolo')
    expect(s.reasoningEffort).toBe('medium')
    expect(s.routingMode).toBe('manual')
    expect(configMock.save).toHaveBeenCalled()
  })
})
