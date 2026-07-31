import { useState, useCallback, useEffect } from 'react'
import { useThemeStore } from './stores/theme'
import { useAppStore } from './stores/app'
import { useProviderStore } from './stores/provider'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import Settings from './components/Settings'
import PermissionDialog from './components/PermissionDialog'
import CommandPalette from './components/CommandPalette'
import RightPanel from './components/RightPanel'

export default function App(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl + K = Command Palette
      if (mod && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(true)
        return
      }

      // Cmd/Ctrl + , = Settings
      if (mod && e.key === ',') {
        e.preventDefault()
        setShowSettings((v) => !v)
      }

      // Cmd/Ctrl + N = New session
      if (mod && e.key === 'n') {
        e.preventDefault()
        if (activeProjectId) addSession(activeProjectId)
      }

      // Cmd/Ctrl + B = toggle the left sidebar
      if (mod && !e.altKey && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      // Escape = close modals
      if (e.key === 'Escape') {
        if (showCommandPalette) setShowCommandPalette(false)
        if (showSettings) setShowSettings(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSettings, showCommandPalette, activeProjectId, addSession, toggleSidebar])

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
