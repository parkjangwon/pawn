import { useState, useCallback, useEffect } from 'react'
import { useEffectiveTheme, useThemeStore } from './stores/theme'
import { useAppStore } from './stores/app'
import { useProviderStore } from './stores/provider'
import { usePrefsStore } from './stores/prefs'
import { useRoutineStore } from './stores/routine'
import { useKeybindingsStore, useKeybinding } from './stores/keybindings'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import Settings from './components/Settings'
import PermissionDialog from './components/PermissionDialog'
import CommandPalette from './components/CommandPalette'
import RightPanel from './components/RightPanel'

export default function App(): React.JSX.Element {
  const theme = useEffectiveTheme()
  const [showSettings, setShowSettings] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('pawn-sidebar-open') !== 'false' } catch { return true }
  })

  // Initialize data from backend on mount
  useEffect(() => {
    useThemeStore.getState().init()
    useAppStore.getState().init()
    useProviderStore.getState().init()
    void usePrefsStore.getState().init()
    void useRoutineStore.getState().init()
    void useKeybindingsStore.getState().init()
  }, [])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => {
      const next = !v
      try { localStorage.setItem('pawn-sidebar-open', String(next)) } catch {}
      return next
    })
  }, [])

  const { projects, activeProjectId, addSession } = useAppStore()

  // In Electron the main process forwards shortcuts from whichever webContents
  // has focus; renderer-side handlers are only for dev:web (no main process).
  const isBrowserMode = window.api?.platform === 'browser'

  // Bindable keyboard shortcuts.
  useKeybinding('open-command-palette', useCallback(() => { if (isBrowserMode) setShowCommandPalette(true) }, [isBrowserMode]))
  useKeybinding('open-settings', useCallback(() => { if (isBrowserMode) setShowSettings((v) => !v) }, [isBrowserMode]))
  useKeybinding('new-session', useCallback(() => { if (isBrowserMode && activeProjectId) addSession(activeProjectId) }, [isBrowserMode, activeProjectId, addSession]))
  useKeybinding('toggle-sidebar', useCallback(() => { if (isBrowserMode) toggleSidebar() }, [isBrowserMode, toggleSidebar]))

  // Electron: main-process forwarding dispatches every bound action here.
  useEffect(() => {
    return window.api?.onAppShortcut?.((id) => {
      if (id === 'toggle-sidebar') toggleSidebar()
      else if (id === 'open-command-palette') setShowCommandPalette(true)
      else if (id === 'open-settings') setShowSettings((v) => !v)
      else if (id === 'new-session') { if (activeProjectId) addSession(activeProjectId) }
    })
  }, [toggleSidebar, activeProjectId, addSession])

  // Escape closes modals.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (showCommandPalette) setShowCommandPalette(false)
        if (showSettings) setShowSettings(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSettings, showCommandPalette])

  // Bridge for the command palette (and anything else that needs it).
  useEffect(() => {
    (window as any).__toggleSidebar = toggleSidebar
    return () => { delete (window as any).__toggleSidebar }
  }, [toggleSidebar])

  return (
    <div className={`app ${theme} ${sidebarOpen ? '' : 'sidebar-collapsed'} ${window.api?.platform === 'darwin' ? 'platform-mac' : ''}`}>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={closeSidebar} />
      )}
      <Sidebar onOpenSettings={() => setShowSettings(true)} onToggle={toggleSidebar} open={sidebarOpen} />
      <div className="main-column">
        <ChatArea onToggleSidebar={toggleSidebar} onOpenSettings={() => setShowSettings(true)} />
      </div>
      <RightPanel />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
      <PermissionDialog />
    </div>
  )
}
