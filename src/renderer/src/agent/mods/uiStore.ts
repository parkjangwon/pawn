import { create } from 'zustand'

export interface ModPaneState {
  id: string
  title: string
  plugin: string
  placement: string
  rows?: number
  /** Frozen UI tree from $.ui.resolve constructors, if provided. */
  tree?: unknown
}

export interface ModToast {
  id: string
  plugin: string
  text: string
  expiresAt: number
}

export interface ModNotice {
  id: string
  plugin: string
  text: string
  kind: 'block' | 'answer' | 'info'
  at: number
}

export interface ModTimelineEntry {
  id: string
  plugin: string
  text: string
  kind: 'block' | 'answer' | 'info' | 'press' | 'conflict'
  at: number
}

interface ModsUiState {
  /** Generation bumped on $.ui.invalidate — React components re-emit ui.render. */
  renderGeneration: number
  /** Bumped whenever the mod runtime loads/unloads (chip / tab badge). */
  runtimeGeneration: number
  spinnerSuffix: string
  /** One band per mod that drew AbovePrompt. Order is hook order. */
  abovePrompts: Array<{ plugin: string; tree: unknown }>
  statusByPlugin: Record<string, string>
  toasts: ModToast[]
  notices: ModNotice[]
  timeline: ModTimelineEntry[]
  logs: Array<{ plugin: string; text: string; at: number }>
  panes: ModPaneState[]
  invalidate: () => void
  bumpRuntime: () => void
  setSpinnerSuffix: (suffix: string) => void
  setAbovePrompts: (bands: Array<{ plugin: string; tree: unknown }>) => void
  setStatus: (plugin: string, text: string) => void
  pushToast: (plugin: string, text: string, timeoutMs?: number) => void
  dismissToast: (id: string) => void
  pushNotice: (plugin: string, text: string, kind?: ModNotice['kind']) => void
  dismissNotice: (id: string) => void
  pushTimeline: (plugin: string, text: string, kind?: ModTimelineEntry['kind']) => void
  clearTimeline: () => void
  pushLog: (plugin: string, text: string) => void
  openPane: (pane: ModPaneState) => void
  updatePaneTree: (id: string, tree: unknown) => void
  closePane: (id: string) => void
  clearSessionUi: () => void
}

let toastSeq = 0
let noticeSeq = 0
let timelineSeq = 0

export const useModsUiStore = create<ModsUiState>((set, get) => ({
  renderGeneration: 0,
  runtimeGeneration: 0,
  spinnerSuffix: '',
  abovePrompts: [],
  statusByPlugin: {},
  toasts: [],
  notices: [],
  timeline: [],
  logs: [],
  panes: [],
  invalidate: () => set({ renderGeneration: get().renderGeneration + 1 }),
  bumpRuntime: () => set({ runtimeGeneration: get().runtimeGeneration + 1 }),
  setSpinnerSuffix: (suffix) => set({ spinnerSuffix: suffix }),
  setAbovePrompts: (bands) => set({ abovePrompts: bands }),
  setStatus: (plugin, text) =>
    set({ statusByPlugin: { ...get().statusByPlugin, [plugin]: text } }),
  pushToast: (plugin, text, timeoutMs = 4000) => {
    const id = `toast-${++toastSeq}`
    const expiresAt = Date.now() + Math.max(500, timeoutMs)
    set({ toasts: [...get().toasts, { id, plugin, text, expiresAt }] })
    window.setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    }, Math.max(500, timeoutMs))
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  pushNotice: (plugin, text, kind = 'info') => {
    const id = `notice-${++noticeSeq}`
    const notices = [...get().notices, { id, plugin, text, kind, at: Date.now() }].slice(-8)
    set({ notices })
    get().pushTimeline(plugin, text, kind === 'info' ? 'info' : kind)
    window.setTimeout(() => {
      set({ notices: get().notices.filter((n) => n.id !== id) })
    }, 8000)
  },
  dismissNotice: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  pushTimeline: (plugin, text, kind = 'info') => {
    const id = `tl-${++timelineSeq}`
    const timeline = [...get().timeline, { id, plugin, text, kind, at: Date.now() }].slice(-40)
    set({ timeline })
  },
  clearTimeline: () => set({ timeline: [] }),
  pushLog: (plugin, text) => {
    const logs = [...get().logs, { plugin, text, at: Date.now() }].slice(-50)
    set({ logs })
  },
  openPane: (pane) => {
    const rest = get().panes.filter((p) => p.id !== pane.id)
    set({ panes: [...rest, pane] })
  },
  updatePaneTree: (id, tree) =>
    set({
      panes: get().panes.map((p) => (p.id === id ? { ...p, tree } : p))
    }),
  closePane: (id) => set({ panes: get().panes.filter((p) => p.id !== id) }),
  clearSessionUi: () =>
    set({
      spinnerSuffix: '',
      abovePrompts: [],
      statusByPlugin: {},
      toasts: [],
      notices: [],
      timeline: [],
      logs: [],
      panes: [],
      renderGeneration: get().renderGeneration + 1
    })
}))
