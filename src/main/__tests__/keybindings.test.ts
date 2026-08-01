import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { on: vi.fn(), isPackaged: true },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() },
  session: {}
}))

vi.mock('../config', () => ({ loadConfig: () => ({}) }))
vi.mock('../window', () => ({ getMainWindow: () => null }))

import { matchesKeybinding, initKeybindings, setKeybinding } from '../ipc/keybindings'

const input = (overrides: Record<string, unknown> = {}) => ({
  key: 'b', code: 'KeyB', alt: true, control: false, meta: true, shift: false, ...overrides
})

describe('matchesKeybinding', () => {
  beforeEach(() => {
    initKeybindings()
  })

  it('matches the default right-panel combo', () => {
    expect(matchesKeybinding('toggle-right-panel', input())).toBe(true)
  })

  it('matches by physical code when Option changes the reported key', () => {
    // macOS reports Option+B as '∫'; the physical code stays KeyB.
    expect(matchesKeybinding('toggle-right-panel', input({ key: '∫' }))).toBe(true)
  })

  it('accepts Ctrl where the binding uses Meta and vice versa', () => {
    expect(matchesKeybinding('toggle-right-panel', input({ control: true, meta: false }))).toBe(true)
    expect(matchesKeybinding('toggle-sidebar', input({ meta: true, alt: false }))).toBe(true)
    expect(matchesKeybinding('toggle-sidebar', input({ control: true, meta: false, alt: false }))).toBe(true)
  })

  it('rejects a different key or missing modifier', () => {
    expect(matchesKeybinding('toggle-right-panel', input({ key: 'l', code: 'KeyL' }))).toBe(false)
    expect(matchesKeybinding('toggle-right-panel', input({ alt: false }))).toBe(false)
  })

  it('honors overrides pushed from the renderer', () => {
    setKeybinding('toggle-right-panel', 'Alt+Meta+L')
    expect(matchesKeybinding('toggle-right-panel', input())).toBe(false)
    expect(matchesKeybinding('toggle-right-panel', input({ key: 'l', code: 'KeyL' }))).toBe(true)
  })
})
