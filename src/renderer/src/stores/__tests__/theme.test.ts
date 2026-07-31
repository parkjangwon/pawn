// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThemeStore } from '../theme'

const saveMock = vi.fn().mockResolvedValue({})
const loadMock = vi.fn()

beforeEach(() => {
  ;(window as any).api = { config: { save: saveMock, load: loadMock } }
  saveMock.mockClear()
  loadMock.mockClear()
  useThemeStore.setState({ theme: 'dark' })
})

describe('theme store', () => {
  it('toggles between light and dark and persists', () => {
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(saveMock).toHaveBeenCalledWith({ settings: { theme: 'light' } })

    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('sets a theme explicitly and persists', () => {
    useThemeStore.getState().set('light')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(saveMock).toHaveBeenCalledWith({ settings: { theme: 'light' } })
  })

  it('initializes from saved config', async () => {
    loadMock.mockResolvedValue({ settings: { theme: 'light' } })
    await useThemeStore.getState().init()
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('keeps the default when config has no theme', async () => {
    loadMock.mockResolvedValue({ settings: {} })
    useThemeStore.setState({ theme: 'dark' })
    await useThemeStore.getState().init()
    expect(useThemeStore.getState().theme).toBe('dark')
  })
})
