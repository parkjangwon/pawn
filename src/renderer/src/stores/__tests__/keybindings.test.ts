// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  parseCombo, comboToString, formatCombo, DEFAULT_KEYBINDINGS,
  useKeybindingsStore, useKeybinding
} from '../keybindings'

const saveMock = vi.fn().mockResolvedValue({})
const loadMock = vi.fn()
const keybindingsSetMock = vi.fn().mockResolvedValue({})

beforeEach(() => {
  ;(window as any).api = {
    config: { save: saveMock, load: loadMock },
    keybindings: { set: keybindingsSetMock }
  }
  saveMock.mockClear()
  loadMock.mockClear()
  keybindingsSetMock.mockClear()
  useKeybindingsStore.setState({ bindings: { ...DEFAULT_KEYBINDINGS } })
})

describe('combo parsing', () => {
  it('parses and round-trips combinations', () => {
    expect(parseCombo('Alt+Meta+B')).toEqual({ alt: true, ctrl: false, meta: true, shift: false, key: 'B' })
    expect(comboToString({ alt: true, ctrl: false, meta: true, shift: false, key: 'B' })).toBe('Alt+Meta+B')
    expect(parseCombo('Ctrl+Shift+K')).toEqual({ alt: false, ctrl: true, meta: false, shift: true, key: 'K' })
  })

  it('rejects modifier-only or empty combos', () => {
    expect(parseCombo('')).toBeNull()
    expect(parseCombo('Meta')).toBeNull()
    expect(parseCombo('Alt+Shift')).toBeNull()
  })

  it('formats for mac and other platforms', () => {
    expect(formatCombo('Alt+Meta+B', 'darwin')).toBe('⌥⌘B')
    expect(formatCombo('Alt+Meta+B', 'win32')).toBe('Alt+Ctrl+B')
    expect(formatCombo('Meta+K', 'darwin')).toBe('⌘K')
  })
})

describe('keybindings store', () => {
  it('persists changes and syncs the main process', () => {
    useKeybindingsStore.getState().setBinding('open-settings', 'Alt+Shift+S')
    expect(useKeybindingsStore.getState().bindings['open-settings']).toBe('Alt+Shift+S')
    expect(saveMock).toHaveBeenCalledWith({ settings: { keybindings: expect.objectContaining({ 'open-settings': 'Alt+Shift+S' }) } })
    expect(keybindingsSetMock).toHaveBeenCalledWith('open-settings', 'Alt+Shift+S')
  })

  it('ignores invalid bindings', () => {
    useKeybindingsStore.getState().setBinding('new-session', 'Meta+')
    expect(useKeybindingsStore.getState().bindings['new-session']).toBe(DEFAULT_KEYBINDINGS['new-session'])
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('merges saved bindings over defaults on init', async () => {
    loadMock.mockResolvedValue({ settings: { keybindings: { 'toggle-sidebar': 'Alt+Meta+L', 'new-session': 'Meta+' } } })
    await useKeybindingsStore.getState().init()
    expect(useKeybindingsStore.getState().bindings['toggle-sidebar']).toBe('Alt+Meta+L')
    expect(useKeybindingsStore.getState().bindings['new-session']).toBe(DEFAULT_KEYBINDINGS['new-session'])
  })

  it('resets to defaults', () => {
    useKeybindingsStore.getState().setBinding('new-session', 'Alt+Shift+N')
    useKeybindingsStore.getState().reset('new-session')
    expect(useKeybindingsStore.getState().bindings['new-session']).toBe(DEFAULT_KEYBINDINGS['new-session'])
  })
})

describe('useKeybinding', () => {
  it('fires the handler on the bound combo', () => {
    const handler = vi.fn()
    renderHook(() => useKeybinding('open-command-palette', handler))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    })
    expect(handler).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('accepts Ctrl where the binding uses Meta and vice versa', () => {
    const handler = vi.fn()
    renderHook(() => useKeybinding('toggle-right-panel', handler))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', altKey: true, metaKey: true }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', altKey: true, ctrlKey: true }))
    })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('matches by physical code when Option changes the key character', () => {
    const handler = vi.fn()
    renderHook(() => useKeybinding('toggle-right-panel', handler))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '∫', code: 'KeyB', altKey: true, metaKey: true }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
