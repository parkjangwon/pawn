import { app, ipcMain, type WebContents } from 'electron'
import { handleTrusted } from './trust'
import { loadConfig } from '../config'
import { getMainWindow } from '../window'

/**
 * Renderer-owned keybinding overrides, mirrored here so the embedded browser
 * can forward the right-panel toggle while it holds keyboard focus.
 */

interface Combo {
  alt: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  key: string
}

const MODIFIERS = new Set(['Alt', 'Control', 'Ctrl', 'Meta', 'Command', 'Shift'])

function parseCombo(combo: string): Combo | null {
  const parts = String(combo || '').split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const key = parts[parts.length - 1]
  if (!key || MODIFIERS.has(key)) return null
  const c: Combo = { alt: false, ctrl: false, meta: false, shift: false, key }
  for (const p of parts.slice(0, -1)) {
    if (p === 'Alt' || p === 'Option') c.alt = true
    else if (p === 'Control' || p === 'Ctrl') c.ctrl = true
    else if (p === 'Meta' || p === 'Command' || p === 'Cmd') c.meta = true
    else if (p === 'Shift') c.shift = true
    else return null
  }
  return c
}

const bindings = new Map<string, string>()
let forwardingPaused = false

// Keep in sync with the renderer's DEFAULT_KEYBINDINGS; config overrides win.
const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'toggle-right-panel': 'Alt+Meta+B',
  'toggle-sidebar': 'Meta+B',
  'open-command-palette': 'Meta+K',
  'open-settings': 'Meta+,',
  'new-session': 'Meta+N'
}

/** Actions the main process can forward on behalf of the renderer. */
export const SHORTCUT_ACTIONS = [
  'toggle-right-panel',
  'toggle-sidebar',
  'open-command-palette',
  'open-settings',
  'new-session'
] as const

export function setKeybinding(id: string, combo: string): void {
  if (parseCombo(combo)) bindings.set(id, combo)
}

/** While the settings recorder is capturing a combo, stop forwarding so the
 *  pressed keys reach the renderer unchanged. */
export function setForwardingPaused(paused: boolean): void {
  forwardingPaused = paused
}

/** Physical-key code for a combo key. On macOS, Option can change the reported
 *  `key` character (e.g. Option+B reports '∫'), so matching also has to check
 *  the physical `code` (KeyB) or Option-modified shortcuts never fire. */
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

export function matchesKeybinding(
  id: string,
  input: { key: string; code: string; alt: boolean; control: boolean; meta: boolean; shift: boolean }
): boolean {
  const combo = parseCombo(bindings.get(id) || '')
  if (!combo) return false
  // Meta and Ctrl are interchangeable across platforms.
  const wantMetaCtrl = combo.meta || combo.ctrl
  const haveMetaCtrl = input.meta || input.control
  const modsMatch = combo.meta === combo.ctrl
    ? input.meta === combo.meta && input.control === combo.ctrl
    : haveMetaCtrl === wantMetaCtrl
  return (
    modsMatch &&
    input.alt === combo.alt &&
    input.shift === combo.shift &&
    (input.key.toLowerCase() === combo.key.toLowerCase() || input.code === keyCodeFor(combo.key))
  )
}

export function initKeybindings(): void {
  for (const [id, combo] of Object.entries(DEFAULT_KEYBINDINGS)) {
    bindings.set(id, combo)
  }
  try {
    const cfg = loadConfig() as { settings?: { keybindings?: Record<string, string> } }
    for (const [id, combo] of Object.entries(cfg.settings?.keybindings || {})) {
      setKeybinding(id, combo)
    }
  } catch {
    // Missing config — defaults apply.
  }
}

/**
 * Structural shortcut handling: every webContents in the app (main window,
 * embedded browser, DevTools) forwards matching keydowns to the main window
 * through before-input-event, so bindings work no matter where focus is.
 * Renderer-side keydown handlers stay browser-mode-only to avoid double toggles.
 */
export function registerShortcutForwarding(): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('before-input-event', (event, input) => {
      if (forwardingPaused || input.type !== 'keyDown' || input.isAutoRepeat || input.key === 'Process') return
      for (const id of SHORTCUT_ACTIONS) {
        if (matchesKeybinding(id, input)) {
          event.preventDefault()
          const win = getMainWindow()
          if (win && !win.isDestroyed()) win.webContents.send('app:shortcut', id)
          return
        }
      }
    })
  })
}

export function registerKeybindingsIpc(): void {
  handleTrusted('keybindings:set', async (_, id: string, combo: string) => {
    setKeybinding(id, combo)
    return { ok: true }
  })
  handleTrusted('keybindings:setPaused', async (_, paused: boolean) => {
    setForwardingPaused(paused === true)
    return { ok: true }
  })
}
