import { create } from 'zustand'
import type { ModSlotKind, ModSlotView } from './types'
import type { ModView } from './views'

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
  /** Project-scoped chrome. Survives a chat switch; cleared with the runtime. */
  slots: ModSlotView[]
  /** `${plugin}\0${id}` of the Settings page on screen, or null. */
  activeSettingsKey: string | null
  /** Custom views from `$.view.open`. Cleared with the runtime. */
  views: ModView[]
  /** `${plugin}\0${id}` of the selected tab view, or null. */
  activeViewTab: string | null
  openView: (view: Omit<ModView, 'rev'>) => void
  closeView: (plugin: string, id: string) => void
  setActiveViewTab: (key: string | null) => void
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
  upsertSlot: (slot: ModSlotView) => void
  removeSlot: (plugin: string, slot: ModSlotKind, id: string) => void
  toggleSidebar: (plugin: string, id: string) => void
  setActiveSettingsKey: (key: string | null) => void
  clearSessionUi: () => void
  /** Chat switch: drop per-chat chrome but keep what mods set for the project (status, bands). */
  clearChatUi: () => void
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
  slots: [],
  activeSettingsKey: null,
  views: [],
  activeViewTab: null,
  openView: (view) => {
    const prev = get().views.find((v) => v.plugin === view.plugin && v.id === view.id)
    const rest = get().views.filter((v) => !(v.plugin === view.plugin && v.id === view.id))
    const next = { ...view, rev: (prev?.rev || 0) + 1 }
    set({
      views: [...rest, next],
      activeViewTab: view.placement === 'tab' ? `${view.plugin}\0${view.id}` : get().activeViewTab
    })
  },
  closeView: (plugin, id) => {
    const key = `${plugin}\0${id}`
    set({
      views: get().views.filter((v) => !(v.plugin === plugin && v.id === id)),
      activeViewTab: get().activeViewTab === key ? null : get().activeViewTab
    })
  },
  setActiveViewTab: (key) => set({ activeViewTab: key }),
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
  upsertSlot: (slot) => {
    const prev = get().slots.find((s) => s.plugin === slot.plugin && s.slot === slot.slot && s.id === slot.id)
    const next = { ...slot, collapsed: slot.collapsed ?? prev?.collapsed }
    const rest = get().slots.filter((s) => !(s.plugin === slot.plugin && s.slot === slot.slot && s.id === slot.id))
    const active =
      slot.slot === 'settings' && get().activeSettingsKey === `${slot.plugin}\0${slot.id}`
        ? get().activeSettingsKey
        : get().activeSettingsKey
    set({ slots: [...rest, next], activeSettingsKey: active })
  },
  removeSlot: (plugin, slot, id) => {
    const key = `${plugin}\0${id}`
    set({
      slots: get().slots.filter((s) => !(s.plugin === plugin && s.slot === slot && s.id === id)),
      activeSettingsKey: slot === 'settings' && get().activeSettingsKey === key ? null : get().activeSettingsKey
    })
  },
  toggleSidebar: (plugin, id) =>
    set({
      slots: get().slots.map((s) =>
        s.slot === 'sidebar' && s.plugin === plugin && s.id === id ? { ...s, collapsed: !s.collapsed } : s
      )
    }),
  setActiveSettingsKey: (key) => set({ activeSettingsKey: key }),
  clearChatUi: () =>
    set({
      toasts: [],
      notices: [],
      timeline: [],
      logs: [],
      panes: [],
      renderGeneration: get().renderGeneration + 1
    }),
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
      slots: [],
      activeSettingsKey: null,
      views: [],
      activeViewTab: null,
      renderGeneration: get().renderGeneration + 1
    })
}))
