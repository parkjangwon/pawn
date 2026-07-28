import { useThemeStore } from './stores/theme'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'

export default function App(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)

  return (
    <div className={`app ${theme}`}>
      <Sidebar />
      <ChatArea />
    </div>
  )
}
