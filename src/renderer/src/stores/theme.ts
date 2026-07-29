import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  toggle: () => void
  set: (theme: Theme) => void
  init: () => Promise<void>
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    set({ theme: next })
    window.api.config.save({ settings: { theme: next } }).catch(() => {})
  },
  set: (theme) => {
    set({ theme })
    window.api.config.save({ settings: { theme } }).catch(() => {})
  },
  init: async () => {
    try {
      const config = await window.api.config.load()
      if (config.settings?.theme) {
        set({ theme: config.settings.theme as Theme })
      }
    } catch { /* use default */ }
  }
}))
