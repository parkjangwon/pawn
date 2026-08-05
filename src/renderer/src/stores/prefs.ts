import { create } from 'zustand'

export type SleepPreventionMode = 'off' | 'sleep' | 'display'

interface PrefsState {
  /** Whether the system is kept awake, and how aggressively. */
  sleepPrevention: SleepPreventionMode
  /** Whether to notify once when a turn (chat reply or coding work) completes. */
  taskNotificationsEnabled: boolean
  /** When true (default), confirm before quitting (Cmd+Q / tray Quit). */
  confirmQuit: boolean
  initialized: boolean
  init: () => Promise<void>
  setSleepPrevention: (mode: SleepPreventionMode) => void
  setTaskNotificationsEnabled: (enabled: boolean) => void
  setConfirmQuit: (enabled: boolean) => void
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  sleepPrevention: 'off',
  taskNotificationsEnabled: true,
  confirmQuit: true,
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    try {
      const cfg = await window.api.config.load() as Record<string, unknown>
      const settings = (cfg as {
        settings?: {
          sleepPrevention?: string
          taskNotificationsEnabled?: boolean
          taskNotifications?: string
          confirmQuit?: boolean
        }
      }).settings
      const sleepMode: SleepPreventionMode = settings?.sleepPrevention === 'sleep' || settings?.sleepPrevention === 'display' ? settings.sleepPrevention : 'off'
      // Migrate the old three-way string mode: only 'off' meant disabled.
      const enabled = typeof settings?.taskNotificationsEnabled === 'boolean'
        ? settings.taskNotificationsEnabled
        : settings?.taskNotifications !== 'off'
      const confirmQuit = settings?.confirmQuit !== false
      set({ sleepPrevention: sleepMode, taskNotificationsEnabled: enabled, confirmQuit })
      void window.api.power?.setSleepPrevention?.(sleepMode)
    } catch {
      // Desktop-only feature; keep the OS policy untouched.
    }
  },

  setSleepPrevention: (mode) => {
    set({ sleepPrevention: mode })
    window.api.config.save({ settings: { sleepPrevention: mode } }).catch(() => {})
    void window.api.power?.setSleepPrevention?.(mode)
  },

  setTaskNotificationsEnabled: (enabled) => {
    set({ taskNotificationsEnabled: enabled })
    window.api.config.save({ settings: { taskNotificationsEnabled: enabled } }).catch(() => {})
  },

  setConfirmQuit: (enabled) => {
    set({ confirmQuit: enabled })
    // Keep main-process guard in sync immediately (before-quit reads config,
    // but also expose explicit IPC for tests / dual writers).
    void window.api.prefs?.setConfirmQuit?.(enabled)
    window.api.config.save({ settings: { confirmQuit: enabled } }).catch(() => {})
  }
}))
