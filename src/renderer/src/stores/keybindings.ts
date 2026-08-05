import { create } from 'zustand'
import { useEffect } from 'react'

export type KeyBindingId =
  | 'toggle-right-panel'
  | 'toggle-terminal'
  | 'toggle-sidebar'
  | 'open-command-palette'
  | 'open-settings'
  | 'new-session'

export interface KeyCombo {
  alt: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  key: string
}

export const KEYBINDING_IDS: KeyBindingId[] = [
  'toggle-right-panel',
  'toggle-terminal',
  'toggle-sidebar',
  'open-command-palette',
  'open-settings',
  'new-session'
]

export const DEFAULT_KEYBINDINGS: Record<KeyBindingId, string> = {
  'toggle-right-panel': 'Alt+Meta+B',
  // Control+` — same muscle memory as VS Code / most IDE terminal panels.
  'toggle-terminal': 'Ctrl+`',
  'toggle-sidebar': 'Meta+B',
  'open-command-palette': 'Meta+K',
  'open-settings': 'Meta+,',
  'new-session': 'Meta+N'
}

const MODIFIERS = new Set(['Alt', 'Control', 'Ctrl', 'Meta', 'Command', 'Shift'])

/** Physical-key code for a combo key (mirrors src/main/ipc/keybindings.ts).
 *  macOS Option can change the reported `key` character, so combos also match
 *  on the physical code (e.g. Option+B reports '∫' with code KeyB). */
function keyCodeFor(key: string): string | null {
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  const named: Record<string, string> = {
    ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote',
    '[': 'BracketLeft', ']': 'BracketRight', '`': 'Backquote', '-': 'Minus',
    '=': 'Equal', '\\': 'Backslash',
    'Enter': 'Enter', 'Tab': 'Tab', ' ': 'Space', 'Space': 'Space',
    'Escape': 'Escape', 'Backspace': 'Backspace', 'Delete': 'Delete',
    'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown',
    'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight'
  }
  return named[key] ?? null
}

export function parseCombo(combo: string): KeyCombo | null {
  const parts = String(combo || '').split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const key = parts[parts.length - 1]
  if (!key || MODIFIERS.has(key)) return null
  const c: KeyCombo = { alt: false, ctrl: false, meta: false, shift: false, key }
  for (const p of parts.slice(0, -1)) {
    if (p === 'Alt' || p === 'Option') c.alt = true
    else if (p === 'Control' || p === 'Ctrl') c.ctrl = true
    else if (p === 'Meta' || p === 'Command' || p === 'Cmd') c.meta = true
    else if (p === 'Shift') c.shift = true
    else return null
  }
  return c
}

export function comboToString(c: KeyCombo): string {
  const parts: string[] = []
  if (c.ctrl) parts.push('Ctrl')
  if (c.alt) parts.push('Alt')
  if (c.shift) parts.push('Shift')
  if (c.meta) parts.push('Meta')
  parts.push(c.key)
  return parts.join('+')
}

/** Display form: ⌘⌥⇧+ key on macOS, Ctrl+Alt+... elsewhere. */
export function formatCombo(combo: string, platform = window.api?.platform): string {
  const c = parseCombo(combo)
  if (!c) return combo
  const mods: string[] = []
  // Standard order: Control, Option, Shift, Command. Meta and Ctrl are
  // interchangeable on every platform, so a Meta binding reads as Ctrl
  // elsewhere and vice versa.
  if (c.ctrl) mods.push(platform === 'darwin' ? '⌃' : 'Ctrl+')
  if (c.alt) mods.push(platform === 'darwin' ? '⌥' : 'Alt+')
  if (c.shift) mods.push(platform === 'darwin' ? '⇧' : 'Shift+')
  if (c.meta) mods.push(platform === 'darwin' ? '⌘' : 'Ctrl+')
  const key = c.key.length === 1 ? c.key.toUpperCase() : c.key
  return mods.join('') + key
}

interface KeybindingsState {
  bindings: Record<KeyBindingId, string>
  init: () => Promise<void>
  setBinding: (id: KeyBindingId, combo: string) => void
  reset: (id: KeyBindingId) => void
}

function loadSaved(): Record<KeyBindingId, string> {
  return { ...DEFAULT_KEYBINDINGS }
}

export const useKeybindingsStore = create<KeybindingsState>((set, get) => ({
  bindings: loadSaved(),

  init: async () => {
    try {
      const cfg = await window.api.config.load() as Record<string, unknown>
      const saved = (cfg as { settings?: { keybindings?: Partial<Record<KeyBindingId, string>> } }).settings?.keybindings
      if (!saved) return
      const next = { ...DEFAULT_KEYBINDINGS }
      for (const id of KEYBINDING_IDS) {
        const combo = saved[id]
        if (combo && parseCombo(combo)) next[id] = combo
      }
      set({ bindings: next })
    } catch { /* keep defaults */ }
  },

  setBinding: (id, combo) => {
    if (!parseCombo(combo)) return
    const bindings = { ...get().bindings, [id]: combo }
    set({ bindings })
    window.api.config.save({ settings: { keybindings: bindings } }).catch(() => {})
    void window.api.keybindings?.set(id, combo)
  },

  reset: (id) => {
    get().setBinding(id, DEFAULT_KEYBINDINGS[id])
  }
}))

/** Attach a window keydown handler for a binding; re-arms when it changes. */
export function useKeybinding(id: KeyBindingId, handler: (e: KeyboardEvent) => void): void {
  const combo = useKeybindingsStore((s) => s.bindings[id])
  useEffect(() => {
    const parsed = parseCombo(combo)
    if (!parsed) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing) return
      const wantMetaCtrl = parsed.meta || parsed.ctrl
      const haveMetaCtrl = e.metaKey || e.ctrlKey
      const modsMatch = parsed.meta === parsed.ctrl
        ? e.metaKey === parsed.meta && e.ctrlKey === parsed.ctrl
        : haveMetaCtrl === wantMetaCtrl
      if (
        modsMatch &&
        e.altKey === parsed.alt &&
        e.shiftKey === parsed.shift &&
        (e.key.toLowerCase() === parsed.key.toLowerCase() || e.code === keyCodeFor(parsed.key))
      ) {
        e.preventDefault()
        handler(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, handler])
}
