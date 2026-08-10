import { create } from 'zustand'

export type SleepPreventionMode = 'off' | 'sleep' | 'display'

interface PrefsState {
  /** Whether the system is kept awake, and how aggressively. */
  sleepPrevention: SleepPreventionMode
  /** Whether to notify once when a turn (chat reply or coding work) completes. */
  taskNotificationsEnabled: boolean
  /** When true (default), confirm before quitting (Cmd+Q / tray Quit). */
  confirmQuit: boolean
  /**
   * Soft stop when this session's USD cost reaches the cap (0 = unlimited).
   * Checked at the start of each agent loop round.
   */
  sessionBudgetUsd: number
  /**
   * Soft stop when today's on-device usage sum reaches the cap (0 = unlimited).
   */
  dailyBudgetUsd: number
  /** Check GitHub Releases for a newer version on launch (desktop only). */
  checkUpdatesOnLaunch: boolean
  initialized: boolean
  init: () => Promise<void>
  setSleepPrevention: (mode: SleepPreventionMode) => void
  setTaskNotificationsEnabled: (enabled: boolean) => void
  setConfirmQuit: (enabled: boolean) => void
  setSessionBudgetUsd: (n: number) => void
  setDailyBudgetUsd: (n: number) => void
  setCheckUpdatesOnLaunch: (enabled: boolean) => void
}

function clampBudget(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.min(10_000, Math.round(v * 100) / 100)
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  sleepPrevention: 'off',
  taskNotificationsEnabled: true,
  confirmQuit: true,
  sessionBudgetUsd: 0,
  dailyBudgetUsd: 0,
  checkUpdatesOnLaunch: true,
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    try {
      const cfg = (await window.api.config.load()) as Record<string, unknown>
      const settings = (
        cfg as {
          settings?: {
            sleepPrevention?: string
            taskNotificationsEnabled?: boolean
            taskNotifications?: string
            confirmQuit?: boolean
            sessionBudgetUsd?: number
            dailyBudgetUsd?: number
            checkUpdatesOnLaunch?: boolean
          }
        }
      ).settings
      const sleepMode: SleepPreventionMode =
        settings?.sleepPrevention === 'sleep' || settings?.sleepPrevention === 'display'
          ? settings.sleepPrevention
          : 'off'
      const enabled =
        typeof settings?.taskNotificationsEnabled === 'boolean'
          ? settings.taskNotificationsEnabled
          : settings?.taskNotifications !== 'off'
      const confirmQuit = settings?.confirmQuit !== false
      set({
        sleepPrevention: sleepMode,
        taskNotificationsEnabled: enabled,
        confirmQuit,
        sessionBudgetUsd: clampBudget(settings?.sessionBudgetUsd),
        dailyBudgetUsd: clampBudget(settings?.dailyBudgetUsd),
        checkUpdatesOnLaunch: settings?.checkUpdatesOnLaunch !== false
      })
      void window.api.power?.setSleepPrevention?.(sleepMode)?.catch(() => {})
    } catch {
      // Desktop-only feature; keep the OS policy untouched.
    }
  },

  setSleepPrevention: (mode) => {
    set({ sleepPrevention: mode })
    window.api.config.save({ settings: { sleepPrevention: mode } }).catch(() => {})
    void window.api.power?.setSleepPrevention?.(mode)?.catch(() => {})
  },

  setTaskNotificationsEnabled: (enabled) => {
    set({ taskNotificationsEnabled: enabled })
    window.api.config
      .save({ settings: { taskNotificationsEnabled: enabled } })
      .catch(() => {})
  },

  setConfirmQuit: (enabled) => {
    set({ confirmQuit: enabled })
    void window.api.prefs?.setConfirmQuit?.(enabled)?.catch(() => {})
    window.api.config.save({ settings: { confirmQuit: enabled } }).catch(() => {})
  },

  setSessionBudgetUsd: (n) => {
    const sessionBudgetUsd = clampBudget(n)
    set({ sessionBudgetUsd })
    window.api.config.save({ settings: { sessionBudgetUsd } }).catch(() => {})
  },

  setDailyBudgetUsd: (n) => {
    const dailyBudgetUsd = clampBudget(n)
    set({ dailyBudgetUsd })
    window.api.config.save({ settings: { dailyBudgetUsd } }).catch(() => {})
  },

  setCheckUpdatesOnLaunch: (enabled) => {
    set({ checkUpdatesOnLaunch: enabled })
    window.api.config
      .save({ settings: { checkUpdatesOnLaunch: enabled } })
      .catch(() => {})
  }
}))
