// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useThemeStore, useEffectiveTheme } from '../theme'

const saveMock = vi.fn().mockResolvedValue({})
const loadMock = vi.fn()

beforeEach(() => {
  ;(window as any).api = { config: { save: saveMock, load: loadMock } }
  saveMock.mockClear()
  loadMock.mockClear()
  useThemeStore.setState({ theme: 'system', systemDark: false, initialized: false })
})

describe('theme store', () => {
  it('toggles between light and dark and persists', () => {
    useThemeStore.getState().set('dark')
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(saveMock).toHaveBeenLastCalledWith({ settings: { theme: 'light' } })

    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('toggles from system to the opposite of the OS preference', () => {
    useThemeStore.setState({ theme: 'system', systemDark: true })
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.setState({ theme: 'system', systemDark: false })
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('sets a theme explicitly and persists', () => {
    useThemeStore.getState().set('system')
    expect(useThemeStore.getState().theme).toBe('system')
    expect(saveMock).toHaveBeenCalledWith({ settings: { theme: 'system' } })
  })

  it('initializes from saved config, including system', async () => {
    loadMock.mockResolvedValue({ settings: { theme: 'system' } })
    await useThemeStore.getState().init()
    expect(useThemeStore.getState().theme).toBe('system')

    useThemeStore.setState({ initialized: false })
    loadMock.mockResolvedValue({ settings: { theme: 'light' } })
    await useThemeStore.getState().init()
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('keeps the current theme when config has no theme', async () => {
    loadMock.mockResolvedValue({ settings: {} })
    useThemeStore.setState({ theme: 'dark' })
    await useThemeStore.getState().init()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('follows OS theme changes while in system mode', async () => {
    const listener: { fn: ((e: { matches: boolean }) => void) | null } = { fn: null }
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('dark'),
        media: query,
        addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => { listener.fn = cb },
        removeEventListener: vi.fn()
      }))
    })
    loadMock.mockResolvedValue({ settings: {} })
    await useThemeStore.getState().init()
    expect(useThemeStore.getState().systemDark).toBe(true)

    listener.fn?.({ matches: false })
    expect(useThemeStore.getState().systemDark).toBe(false)
  })
})

describe('useEffectiveTheme', () => {
  it('resolves system mode against the OS preference', () => {
    useThemeStore.setState({ theme: 'system', systemDark: true })
    const { result } = renderHook(() => useEffectiveTheme())
    expect(result.current).toBe('dark')

    act(() => { useThemeStore.setState({ systemDark: false }) })
    expect(result.current).toBe('light')
  })

  it('passes explicit choices through', () => {
    useThemeStore.setState({ theme: 'light', systemDark: true })
    const { result } = renderHook(() => useEffectiveTheme())
    expect(result.current).toBe('light')
  })
})
