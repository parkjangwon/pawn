import { create } from 'zustand'
import { uid } from '../utils/uid'
import { guessPricing } from '../types/provider'
import type { Provider, ModelEntry, RoutingMode } from '../types/provider'

interface ProviderState {
  providers: Provider[]
  models: ModelEntry[]
  routingMode: RoutingMode
  activeModelId: string | null
  defaultSendMode: 'queue' | 'steer'
  permissionMode: 'ask' | 'auto' | 'yolo'
  reasoningEffort: 'auto' | 'low' | 'medium' | 'high'
  initialized: boolean
  init: () => Promise<void>

  addProvider: (provider: Provider) => void
  removeProvider: (id: string) => void
  updateProvider: (id: string, patch: Partial<Provider>) => void
  addModel: (model: ModelEntry) => void
  removeModel: (id: string) => void
  updateModel: (id: string, patch: Partial<ModelEntry>) => void
  setRoutingMode: (mode: RoutingMode) => void
  setActiveModel: (id: string | null) => void
  setDefaultSendMode: (mode: 'queue' | 'steer') => void
  setPermissionMode: (mode: 'ask' | 'auto' | 'yolo') => void
  setReasoningEffort: (effort: 'auto' | 'low' | 'medium' | 'high') => void
}

function saveToBackend(state: ProviderState): void {
  window.api.config.save({
    providers: state.providers,
    models: state.models,
    settings: {
      routingMode: state.routingMode,
      activeModelId: state.activeModelId ?? '',
      defaultSendMode: state.defaultSendMode,
      permissionMode: state.permissionMode,
      reasoningEffort: state.reasoningEffort
    }
  })
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  models: [],
  routingMode: 'auto',
  activeModelId: null,
  defaultSendMode: 'queue',
  permissionMode: 'ask',
  reasoningEffort: 'auto',
  initialized: false,

  init: async () => {
    if (get().initialized) return
    try {
      const rawConfig = await window.api.config.load() as Record<string, any>
      const settings = rawConfig.settings || {}
      const models = (rawConfig.models || []) as ModelEntry[]
      // Backfill pricing/tier for models saved before the cost model existed, so
      // the router can reason about them instead of treating them as free.
      const hydrated = models.map((m) => {
        if (m.pricing) return m
        const guess = guessPricing(m.modelId)
        if (!guess) return m
        return {
          ...m,
          pricing: { input: guess.input, output: guess.output, cacheRead: guess.cacheRead, cacheWrite: guess.cacheWrite },
          contextWindow: m.contextWindow || guess.contextWindow
        }
      })
      set({
        providers: rawConfig.providers || [],
        models: hydrated,
        routingMode: (settings.routingMode as RoutingMode) || 'auto',
        activeModelId: settings.activeModelId || null,
        defaultSendMode: (settings.defaultSendMode as 'queue' | 'steer') || 'queue',
        permissionMode: (settings.permissionMode as 'ask' | 'auto' | 'yolo') || 'ask',
        reasoningEffort: (settings.reasoningEffort as 'auto' | 'low' | 'medium' | 'high') || 'auto',
        initialized: true
      })
    } catch {
      set({ initialized: true })
    }
  },

  addProvider: (provider) => {
    const p = { ...provider, id: provider.id || uid() }
    set((s) => { const next = { ...s, providers: [...s.providers, p] }; saveToBackend(next); return { providers: next.providers } })
  },

  removeProvider: (id) => {
    set((s) => { const next = { ...s, providers: s.providers.filter((p) => p.id !== id), models: s.models.filter((m) => m.providerId !== id) }; saveToBackend(next); return { providers: next.providers, models: next.models } })
  },

  updateProvider: (id, patch) => {
    set((s) => { const next = { ...s, providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }; saveToBackend(next); return { providers: next.providers } })
  },

  addModel: (model) => {
    const m = { ...model, id: model.id || uid() }
    set((s) => { const next = { ...s, models: [...s.models, m] }; saveToBackend(next); return { models: next.models } })
  },

  removeModel: (id) => {
    set((s) => {
      const next = { ...s, models: s.models.filter((m) => m.id !== id) }
      if (s.activeModelId === id) next.activeModelId = null
      saveToBackend(next)
      return { models: next.models, activeModelId: next.activeModelId }
    })
  },

  updateModel: (id, patch) => {
    set((s) => {
      const next = { ...s, models: s.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) }
      if (s.activeModelId === id && patch.enabled === false) next.activeModelId = null
      saveToBackend(next)
      return { models: next.models, activeModelId: next.activeModelId }
    })
  },

  setRoutingMode: (mode) => {
    set((s) => { const next = { ...s, routingMode: mode }; saveToBackend(next); return { routingMode: mode } })
  },

  setActiveModel: (id) => {
    // Picking a model from the chip is an explicit choice; auto mode must stop
    // overriding it, and it has to survive a restart.
    set((s) => {
      const next = { ...s, activeModelId: id, routingMode: (id ? 'manual' : s.routingMode) as RoutingMode }
      saveToBackend(next)
      return { activeModelId: id, routingMode: next.routingMode }
    })
  },

  setDefaultSendMode: (mode) => {
    set((s) => { const next = { ...s, defaultSendMode: mode }; saveToBackend(next); return { defaultSendMode: mode } })
  },

  setPermissionMode: (mode) => {
    set((s) => { const next = { ...s, permissionMode: mode }; saveToBackend(next); return { permissionMode: mode } })
  },

  setReasoningEffort: (effort) => {
    set((s) => { const next = { ...s, reasoningEffort: effort }; saveToBackend(next); return { reasoningEffort: effort } })
  }
}))
