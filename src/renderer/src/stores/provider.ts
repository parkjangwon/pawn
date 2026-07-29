import { create } from 'zustand'
import { uid } from '../utils/uid'
import type { Provider, ModelEntry, RoutingMode } from '../types/provider'

interface ProviderState {
  providers: Provider[]
  models: ModelEntry[]
  routingMode: RoutingMode
  activeModelId: string | null
  defaultSendMode: 'queue' | 'steer'
  permissionMode: 'ask' | 'auto' | 'yolo'
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
}

function saveToBackend(state: ProviderState): void {
  window.api.config.save({
    providers: state.providers,
    models: state.models,
    settings: {
      routingMode: state.routingMode,
      defaultSendMode: state.defaultSendMode,
      permissionMode: state.permissionMode
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
  initialized: false,

  init: async () => {
    if (get().initialized) return
    try {
      const rawConfig = await window.api.config.load() as Record<string, unknown>
      set({
        providers: (rawConfig as any).providers || [],
        models: (rawConfig as any).models || [],
        routingMode: ((rawConfig as any).settings?.routingMode as RoutingMode) || 'auto',
        defaultSendMode: ((rawConfig as any).settings?.defaultSendMode as 'queue' | 'steer') || 'queue',
        permissionMode: ((rawConfig as any).settings?.permissionMode as 'ask' | 'auto' | 'yolo') || 'ask',
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
    set((s) => { const next = { ...s, models: s.models.filter((m) => m.id !== id) }; saveToBackend(next); return { models: next.models } })
  },

  updateModel: (id, patch) => {
    set((s) => { const next = { ...s, models: s.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) }; saveToBackend(next); return { models: next.models } })
  },

  setRoutingMode: (mode) => {
    set((s) => { const next = { ...s, routingMode: mode }; saveToBackend(next); return { routingMode: mode } })
  },

  setActiveModel: (id) => set({ activeModelId: id }),

  setDefaultSendMode: (mode) => {
    set((s) => { const next = { ...s, defaultSendMode: mode }; saveToBackend(next); return { defaultSendMode: mode } })
  },

  setPermissionMode: (mode) => {
    set((s) => { const next = { ...s, permissionMode: mode }; saveToBackend(next); return { permissionMode: mode } })
  }
}))
