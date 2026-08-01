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
  usePrefsStore.setState({ sleepPrevention: 'off' })
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
})
