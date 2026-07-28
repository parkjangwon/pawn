import { useState, useCallback, useEffect } from 'react'
import { useThemeStore } from './stores/theme'
import { useAppStore } from './stores/app'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import Settings from './components/Settings'
import PermissionDialog from './components/PermissionDialog'

export default function App(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  const { projects, activeProjectId, addSession } = useAppStore()

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey

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

      // Escape = close modals
      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        if (sidebarOpen) setSidebarOpen(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSettings, sidebarOpen, activeProjectId, addSession])

  return (
    <div className={`app ${theme}`}>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={closeSidebar} />
      )}
      <div className={`sidebar-wrapper ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar onOpenSettings={() => setShowSettings(true)} />
      </div>
      <ChatArea onToggleSidebar={toggleSidebar} />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <PermissionDialog />
    </div>
  )
}
