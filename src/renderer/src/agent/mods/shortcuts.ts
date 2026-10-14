import { eventMatchesCombo, useKeybindingsStore } from '../../stores/keybindings'
import { useModsUiStore } from './uiStore'

const MOD_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const

function canonMod(part: string): (typeof MOD_ORDER)[number] | null {
  const n = part.toLowerCase()
  if (n === 'mod' || n === 'meta' || n === 'command' || n === 'cmd') return 'Mod'
  if (n === 'ctrl' || n === 'control') return 'Ctrl'
  if (n === 'alt' || n === 'option') return 'Alt'
  if (n === 'shift') return 'Shift'
  return null
}

/** Canonical chord: `Mod+Shift+K`. `Mod` is the app's Meta/Ctrl command key. */
export function normalizeShortcut(raw: string): string | null {
  const parts = String(raw || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const keyRaw = parts[parts.length - 1]
  if (!keyRaw || canonMod(keyRaw)) return null
  const mods = new Set<string>()
  for (const part of parts.slice(0, -1)) {
    const mod = canonMod(part)
    if (!mod) return null
    mods.add(mod)
  }
  const key = keyRaw.length === 1 ? keyRaw.toUpperCase() : keyRaw
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+')
}

function partsOf(norm: string): { key: string; alt: boolean; shift: boolean; mod: boolean; ctrl: boolean } {
  const bits = norm.split('+')
  const key = bits.pop() || ''
  const mods = new Set(bits)
  return {
    key,
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
    mod: mods.has('Mod'),
    ctrl: mods.has('Ctrl')
  }
}

/** Same physical chord, treating Mod and Ctrl as the app does (either command key). */
export function shortcutsConflict(a: string, b: string): boolean {
  const na = normalizeShortcut(a)
  const nb = normalizeShortcut(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const fa = partsOf(na)
  const fb = partsOf(nb)
  if (fa.key.toLowerCase() !== fb.key.toLowerCase()) return false
  if (fa.alt !== fb.alt || fa.shift !== fb.shift) return false
  const aFlex = fa.mod !== fa.ctrl
  const bFlex = fb.mod !== fb.ctrl
  if (aFlex && bFlex) return true
  if (!aFlex && !bFlex) return fa.mod === fb.mod && fa.ctrl === fb.ctrl
  const exact = aFlex ? fb : fa
  if (exact.mod === exact.ctrl) return false
  return true
}

export function shortcutConflictMessage(keys: string, plugin: string, id: string): string | null {
  const norm = normalizeShortcut(keys)
  if (!norm) return null
  const bindings = useKeybindingsStore.getState().bindings
  for (const [bid, combo] of Object.entries(bindings)) {
    if (!combo) continue
    if (shortcutsConflict(norm, combo)) {
      return `Shortcut "${norm}" conflicts with the app shortcut ${bid} (${combo})`
    }
  }
  for (const slot of useModsUiStore.getState().slots) {
    if (slot.slot !== 'shortcut' || !slot.keys) continue
    if (slot.plugin === plugin && slot.id === id) continue
    if (shortcutsConflict(norm, slot.keys)) {
      return `Shortcut "${norm}" conflicts with mod ${slot.plugin} shortcut ${slot.id} (${slot.keys})`
    }
  }
  return null
}

/** App matcher, after `Mod` is written as `Meta`. */
export function eventMatchesShortcut(norm: string, e: KeyboardEvent): boolean {
  return eventMatchesCombo(norm.replace(/\bMod\b/g, 'Meta'), e)
}

export function shortcutAllowsTyping(norm: string): boolean {
  return /\b(Mod|Ctrl|Alt)\b/.test(norm)
}
