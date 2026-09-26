// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePrefsStore } from '../prefs'

const saveMock = vi.fn().mockResolvedValue({})
const loadMock = vi.fn()
const powerMock = vi.fn().mockResolvedValue({})

beforeEach(() => {
  ;(window as any).api = {
    config: { save: saveMock, load: loadMock },
    power: { setSleepPrevention: powerMock }
  }
  saveMock.mockClear()
  loadMock.mockClear()
  powerMock.mockClear()
  usePrefsStore.setState({ sleepPrevention: 'off', taskNotificationsEnabled: true, initialized: false })
})

describe('prefs store', () => {
  it('applies the saved sleep prevention mode on init', async () => {
    loadMock.mockResolvedValue({ settings: { sleepPrevention: 'display' } })
    await usePrefsStore.getState().init()
    expect(usePrefsStore.getState().sleepPrevention).toBe('display')
    expect(powerMock).toHaveBeenCalledWith('display')
  })

  it('defaults to off for unknown values', async () => {
    loadMock.mockResolvedValue({ settings: { sleepPrevention: 'banana' } })
    await usePrefsStore.getState().init()
    expect(usePrefsStore.getState().sleepPrevention).toBe('off')
    expect(powerMock).toHaveBeenCalledWith('off')
  })

  it('persists and applies changes immediately', async () => {
    usePrefsStore.getState().setSleepPrevention('sleep')
    expect(usePrefsStore.getState().sleepPrevention).toBe('sleep')
    expect(saveMock).toHaveBeenCalledWith({ settings: { sleepPrevention: 'sleep' } })
    expect(powerMock).toHaveBeenCalledWith('sleep')
  })

  it('applies the saved task notification setting on init', async () => {
    loadMock.mockResolvedValue({ settings: { taskNotificationsEnabled: false } })
    await usePrefsStore.getState().init()
    expect(usePrefsStore.getState().taskNotificationsEnabled).toBe(false)
  })

  it('defaults task notifications to enabled for unknown values', async () => {
    loadMock.mockResolvedValue({ settings: { taskNotificationsEnabled: 'banana' } })
    await usePrefsStore.getState().init()
    expect(usePrefsStore.getState().taskNotificationsEnabled).toBe(true)
  })

  it('migrates the legacy three-way string setting', async () => {
    loadMock.mockResolvedValue({ settings: { taskNotifications: 'off' } })
    await usePrefsStore.getState().init()
    expect(usePrefsStore.getState().taskNotificationsEnabled).toBe(false)

    usePrefsStore.setState({ initialized: false })
    loadMock.mockResolvedValue({ settings: { taskNotifications: 'all' } })
    await usePrefsStore.getState().init()
    expect(usePrefsStore.getState().taskNotificationsEnabled).toBe(true)
  })

  it('persists task notification changes immediately', () => {
    usePrefsStore.getState().setTaskNotificationsEnabled(false)
    expect(usePrefsStore.getState().taskNotificationsEnabled).toBe(false)
    expect(saveMock).toHaveBeenCalledWith({ settings: { taskNotificationsEnabled: false } })
  })

  it('applies, caches, and persists the chat font size', () => {
    usePrefsStore.getState().setChatFontSize(16)
    expect(usePrefsStore.getState().chatFontSize).toBe(16)
    expect(document.documentElement.style.getPropertyValue('--chat-font-size')).toBe('16px')
    expect(localStorage.getItem('pawn-chat-font-size')).toBe('16')
    expect(saveMock).toHaveBeenCalledWith({ settings: { chatFontSize: 16 } })
  })

  it('clamps out-of-range chat font sizes', () => {
    usePrefsStore.getState().setChatFontSize(99)
    expect(usePrefsStore.getState().chatFontSize).toBe(20)
    usePrefsStore.getState().setChatFontSize(Number.NaN)
    expect(usePrefsStore.getState().chatFontSize).toBe(14)
  })

  it('restores the chat font size from config on init', async () => {
    loadMock.mockResolvedValue({ settings: { chatFontSize: 15 } })
    await usePrefsStore.getState().init()
    expect(usePrefsStore.getState().chatFontSize).toBe(15)
    expect(document.documentElement.style.getPropertyValue('--chat-font-size')).toBe('15px')
  })
})
