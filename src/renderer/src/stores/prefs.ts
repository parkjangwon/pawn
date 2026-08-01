import { create } from 'zustand'

export type SleepPreventionMode = 'off' | 'sleep' | 'display'

interface PrefsState {
  /** Whether the system is kept awake, and how aggressively. */
  sleepPrevention: SleepPreventionMode
  init: () => Promise<void>
  setSleepPrevention: (mode: SleepPreventionMode) => void
}

export const usePrefsStore = create<PrefsState>((set) => ({
  sleepPrevention: 'off',

  init: async () => {
    try {
      const cfg = await window.api.config.load() as Record<string, unknown>
      const saved = (cfg as { settings?: { sleepPrevention?: string } }).settings?.sleepPrevention
      const mode: SleepPreventionMode = saved === 'sleep' || saved === 'display' ? saved : 'off'
      set({ sleepPrevention: mode })
      void window.api.power?.setSleepPrevention?.(mode)
    } catch {
      // Desktop-only feature; keep the OS policy untouched.
    }
  },

  setSleepPrevention: (mode) => {
    set({ sleepPrevention: mode })
    window.api.config.save({ settings: { sleepPrevention: mode } }).catch(() => {})
    void window.api.power?.setSleepPrevention?.(mode)
  }
}))
