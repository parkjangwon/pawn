import { create } from 'zustand'
import type { Provider, ModelEntry, RoutingMode } from '../types/provider'

interface ProviderState {
  providers: Provider[]
  models: ModelEntry[]
  routingMode: RoutingMode
  activeModelId: string | null

  addProvider: (provider: Provider) => void
  removeProvider: (id: string) => void
  updateProvider: (id: string, patch: Partial<Provider>) => void

  addModel: (model: ModelEntry) => void
  removeModel: (id: string) => void
  updateModel: (id: string, patch: Partial<ModelEntry>) => void

  setRoutingMode: (mode: RoutingMode) => void
  setActiveModel: (id: string | null) => void
}

let counter = 0
const uid = (): string => `p-${Date.now()}-${++counter}`

export const useProviderStore = create<ProviderState>((set) => ({
  providers: [],
  models: [],
  routingMode: 'auto',
  activeModelId: null,

  addProvider: (provider) =>
    set((s) => ({ providers: [...s.providers, { ...provider, id: provider.id || uid() }] })),

  removeProvider: (id) =>
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      models: s.models.filter((m) => m.providerId !== id)
    })),

  updateProvider: (id, patch) =>
    set((s) => ({
      providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p))
    })),

  addModel: (model) =>
    set((s) => ({ models: [...s.models, { ...model, id: model.id || uid() }] })),

  removeModel: (id) =>
    set((s) => ({ models: s.models.filter((m) => m.id !== id) })),

  updateModel: (id, patch) =>
    set((s) => ({
      models: s.models.map((m) => (m.id === id ? { ...m, ...patch } : m))
    })),

  setRoutingMode: (mode) => set({ routingMode: mode }),
  setActiveModel: (id) => set({ activeModelId: id })
}))
