import { useState, useCallback } from 'react'
import { useThemeStore } from './stores/theme'
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
