import { create } from 'zustand'
import { uid } from '../utils/uid'
import { guessPricing, guessSupportsVision } from '../types/provider'
import type { Provider, ModelEntry, RoutingMode } from '../types/provider'
import { parseAgentMode, parseDoneGate, type AgentMode, type DoneGate } from '../agent/agentMode'

interface ProviderState {
  providers: Provider[]
  models: ModelEntry[]
  routingMode: RoutingMode
  activeModelId: string | null
  /** Preferred fallback for image turns; null = any vision-capable model. */
  visionModelId: string | null
  defaultSendMode: 'queue' | 'steer'
  permissionMode: 'ask' | 'auto' | 'yolo'
  reasoningEffort: 'auto' | 'low' | 'medium' | 'high'
  /** Plan = read-only explore; Build = full tools (OpenCode/Cline-inspired). */
  agentMode: AgentMode
  /** Auto-verify after code edits: off | typecheck | test. */
  doneGate: DoneGate
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
  setVisionModel: (id: string | null) => void
  setDefaultSendMode: (mode: 'queue' | 'steer') => void
  setPermissionMode: (mode: 'ask' | 'auto' | 'yolo') => void
  setReasoningEffort: (effort: 'auto' | 'low' | 'medium' | 'high') => void
  setAgentMode: (mode: AgentMode) => void
  toggleAgentMode: () => void
  setDoneGate: (gate: DoneGate) => void
}

function hydrateModel(m: ModelEntry): ModelEntry {
  let next = m
  if (!m.pricing) {
    const guess = guessPricing(m.modelId)
    if (guess) {
      next = {
        ...next,
        pricing: { input: guess.input, output: guess.output, cacheRead: guess.cacheRead, cacheWrite: guess.cacheWrite },
        contextWindow: m.contextWindow || guess.contextWindow
      }
    }
  }
  // Only fill vision when the user has never set it — preserves explicit false/true.
  if (next.supportsVision === undefined) {
    const vision = guessSupportsVision(next.modelId)
    if (vision !== undefined) next = { ...next, supportsVision: vision }
  }
  return next
}

function saveToBackend(state: ProviderState): void {
  window.api.config.save({
    providers: state.providers,
    models: state.models,
    settings: {
      routingMode: state.routingMode,
      activeModelId: state.activeModelId ?? '',
      visionModelId: state.visionModelId ?? '',
      defaultSendMode: state.defaultSendMode,
      permissionMode: state.permissionMode,
      reasoningEffort: state.reasoningEffort,
      agentMode: state.agentMode,
      doneGate: state.doneGate
    }
  })
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  models: [],
  routingMode: 'auto',
  activeModelId: null,
  visionModelId: null,
  defaultSendMode: 'queue',
  permissionMode: 'ask',
  reasoningEffort: 'auto',
  agentMode: 'build',
  doneGate: 'typecheck',
  initialized: false,

  init: async () => {
    if (get().initialized) return
    try {
      const rawConfig = await window.api.config.load() as Record<string, any>
      const settings = rawConfig.settings || {}
      const models = ((rawConfig.models || []) as ModelEntry[]).map(hydrateModel)
      let visionModelId = (settings.visionModelId as string) || null
      // Drop a stale vision pin if the model was removed.
      if (visionModelId && !models.some((m) => m.id === visionModelId && m.enabled)) {
        visionModelId = null
      }
      // Auto-pick first enabled vision model when unset (DeepSeek + Gemini setups).
      if (!visionModelId) {
        const auto = models.find(
          (m) =>
            m.enabled &&
            (m.supportsVision === true || guessSupportsVision(m.modelId) === true)
        )
        if (auto) visionModelId = auto.id
      }
      set({
        providers: rawConfig.providers || [],
        models,
        routingMode: (settings.routingMode as RoutingMode) || 'auto',
        activeModelId: settings.activeModelId || null,
        visionModelId,
        defaultSendMode: (settings.defaultSendMode as 'queue' | 'steer') || 'queue',
        permissionMode: (settings.permissionMode as 'ask' | 'auto' | 'yolo') || 'ask',
        reasoningEffort: (settings.reasoningEffort as 'auto' | 'low' | 'medium' | 'high') || 'auto',
        agentMode: parseAgentMode(settings.agentMode),
        doneGate: parseDoneGate(settings.doneGate),
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
    set((s) => {
      const models = s.models.filter((m) => m.providerId !== id)
      const next = {
        ...s,
        providers: s.providers.filter((p) => p.id !== id),
        models,
        visionModelId: s.visionModelId && models.some((m) => m.id === s.visionModelId) ? s.visionModelId : null
      }
      saveToBackend(next)
      return { providers: next.providers, models: next.models, visionModelId: next.visionModelId }
    })
  },

  updateProvider: (id, patch) => {
    set((s) => { const next = { ...s, providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }; saveToBackend(next); return { providers: next.providers } })
  },

  addModel: (model) => {
    const withVision = model.supportsVision === undefined
      ? { ...model, supportsVision: guessSupportsVision(model.modelId) }
      : model
    const m = { ...withVision, id: withVision.id || uid() }
    set((s) => { const next = { ...s, models: [...s.models, m] }; saveToBackend(next); return { models: next.models } })
  },

  removeModel: (id) => {
    set((s) => {
      const next = { ...s, models: s.models.filter((m) => m.id !== id) }
      if (s.activeModelId === id) next.activeModelId = null
      if (s.visionModelId === id) next.visionModelId = null
      saveToBackend(next)
      return { models: next.models, activeModelId: next.activeModelId, visionModelId: next.visionModelId }
    })
  },

  updateModel: (id, patch) => {
    set((s) => {
      const next = { ...s, models: s.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) }
      if (s.activeModelId === id && patch.enabled === false) next.activeModelId = null
      if (s.visionModelId === id && patch.enabled === false) next.visionModelId = null
      if (s.visionModelId === id && patch.supportsVision === false) next.visionModelId = null
      saveToBackend(next)
      return { models: next.models, activeModelId: next.activeModelId, visionModelId: next.visionModelId }
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

  setVisionModel: (id) => {
    set((s) => {
      const next = { ...s, visionModelId: id }
      saveToBackend(next)
      return { visionModelId: id }
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
  },

  setAgentMode: (mode) => {
    set((s) => {
      const next = { ...s, agentMode: mode }
      saveToBackend(next)
      return { agentMode: mode }
    })
  },

  toggleAgentMode: () => {
    const cur = get().agentMode
    get().setAgentMode(cur === 'plan' ? 'build' : 'plan')
  },

  setDoneGate: (gate) => {
    set((s) => {
      const next = { ...s, doneGate: gate }
      saveToBackend(next)
      return { doneGate: gate }
    })
  }
}))
