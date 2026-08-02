import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  /** User's theme choice; 'system' follows the OS color scheme. */
  theme: Theme
  /** Current OS preference, kept fresh while in system mode. */
  systemDark: boolean
  initialized: boolean
  toggle: () => void
  set: (theme: Theme) => void
  init: () => Promise<void>
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  } catch {
    return false
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'system',
  systemDark: systemPrefersDark(),
  initialized: false,

  toggle: () => {
    const s = get()
    const current = s.theme === 'system' ? (s.systemDark ? 'dark' : 'light') : s.theme
    const next: Theme = current === 'dark' ? 'light' : 'dark'
    set({ theme: next })
    window.api.config.save({ settings: { theme: next } }).catch(() => {})
  },

  set: (theme) => {
    set({ theme })
    window.api.config.save({ settings: { theme } }).catch(() => {})
  },

  init: async () => {
    // StrictMode double-mounts effects in dev; only one init (and one media
    // query listener) may ever run.
    if (get().initialized) return
    set({ initialized: true })
    // Read the current OS preference and follow it live while on 'system'.
    try {
      const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
      if (mq) {
        set({ systemDark: mq.matches === true })
        mq.addEventListener?.('change', (e) => set({ systemDark: e.matches }))
      }
    } catch { /* older environments */ }

    try {
      const rawConfig = await window.api.config.load() as Record<string, unknown>
      const saved = (rawConfig as any).settings?.theme
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        set({ theme: saved as Theme })
      }
    } catch { /* use default */ }
  }
}))

/** The theme to apply to the DOM: system resolves against the OS preference. */
export function useEffectiveTheme(): 'light' | 'dark' {
  const setting = useThemeStore((s) => s.theme)
  const systemDark = useThemeStore((s) => s.systemDark)
  return setting === 'system' ? (systemDark ? 'dark' : 'light') : setting
}
