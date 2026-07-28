import { useState } from 'react'
import { useThemeStore } from './stores/theme'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import Settings from './components/Settings'
import PermissionDialog from './components/PermissionDialog'

export default function App(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className={`app ${theme}`}>
      <Sidebar onOpenSettings={() => setShowSettings(true)} />
      <ChatArea />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <PermissionDialog />
    </div>
  )
}
