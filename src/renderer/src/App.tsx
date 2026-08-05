import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useEffectiveTheme, useThemeStore } from './stores/theme'
import { useAppStore } from './stores/app'
import { useProviderStore } from './stores/provider'
import { usePrefsStore } from './stores/prefs'
import { useRoutineStore } from './stores/routine'
import { useMcpStore } from './stores/mcp'
import { useKeybindingsStore, useKeybinding } from './stores/keybindings'
import { readStoredSidebarWidth, persistSidebarWidth, clampSidebarWidth } from './hooks/useSidebarResize'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import AutomationView from './components/AutomationView'
import Settings from './components/Settings'
import PermissionDialog from './components/PermissionDialog'
import CommandPalette from './components/CommandPalette'
import RightPanel from './components/RightPanel'
import BottomTerminal from './components/BottomTerminal'

interface NavSnapshot {
  showSettings: boolean
  mainView: 'chat' | 'automations'
  projectId: string | null
  sessionId: string | null
}

interface NavState {
  list: NavSnapshot[]
  index: number
}

export default function App(): React.JSX.Element {
  const theme = useEffectiveTheme()
  const [showSettings, setShowSettings] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [mainView, setMainView] = useState<'chat' | 'automations'>('chat')
  const [appVersion, setAppVersion] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('pawn-sidebar-open') !== 'false' } catch { return true }
  })

  // Sidebar width is a single app-wide preference shared by the main sidebar
  // and the Settings nav. Apply the stored value before first paint; drag
  // handles in either place commit back through this callback.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${readStoredSidebarWidth()}px`)
  }, [])

  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = clampSidebarWidth(width)
    persistSidebarWidth(clamped)
    document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`)
  }, [])

  // Initialize data from backend on mount
  useEffect(() => {
    useThemeStore.getState().init()
    useAppStore.getState().init()
    useProviderStore.getState().init()
    void usePrefsStore.getState().init()
    void useRoutineStore.getState().init()
    void useMcpStore.getState().init()
    void useKeybindingsStore.getState().init()
    void window.api.appVersion().then((v) => { if (v) setAppVersion(v) }).catch(() => {})
  }, [])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => {
      const next = !v
      try { localStorage.setItem('pawn-sidebar-open', String(next)) } catch {}
      return next
    })
  }, [])

  // The main sidebar is hidden behind the full-screen Settings overlay, so
  // toggling it there is invisible. Route the same shortcut to Settings' own
  // nav toggle instead — Settings registers this bridge while it's open.
  const toggleActiveSidebar = useCallback(() => {
    if (showSettings) (window as any).__toggleSettingsNav?.()
    else toggleSidebar()
  }, [showSettings, toggleSidebar])

  const { projects, activeProjectId, activeSessionId, startNewChat } = useAppStore()

  // Browser-style back/forward history over the app's top-level "location":
  // which view is showing, which project/session is focused, and whether
  // Settings is open. Every genuine navigation (not one replayed by back()/
  // forward() themselves) pushes a new entry, truncating any forward branch.
  const [nav, setNav] = useState<NavState>(() => ({
    list: [{ showSettings: false, mainView: 'chat', projectId: activeProjectId, sessionId: activeSessionId }],
    index: 0
  }))
  const isReplayingNavRef = useRef(false)

  useEffect(() => {
    if (isReplayingNavRef.current) { isReplayingNavRef.current = false; return }
    setNav((prev) => {
      const current = prev.list[prev.index]
      if (
        current.showSettings === showSettings &&
        current.mainView === mainView &&
        current.projectId === activeProjectId &&
        current.sessionId === activeSessionId
      ) {
        return prev
      }
      const snapshot: NavSnapshot = { showSettings, mainView, projectId: activeProjectId, sessionId: activeSessionId }
      const list = [...prev.list.slice(0, prev.index + 1), snapshot]
      return { list, index: list.length - 1 }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, mainView, activeProjectId, activeSessionId])

  const applyNavSnapshot = useCallback((snapshot: NavSnapshot) => {
    isReplayingNavRef.current = true
    setShowSettings(snapshot.showSettings)
    setMainView(snapshot.mainView)
    if (snapshot.projectId) useAppStore.getState().setActiveProject(snapshot.projectId)
    if (snapshot.sessionId) useAppStore.getState().setActiveSession(snapshot.sessionId)
  }, [])

  const goBack = useCallback(() => {
    if (nav.index <= 0) return
    const nextIndex = nav.index - 1
    applyNavSnapshot(nav.list[nextIndex])
    setNav((prev) => ({ ...prev, index: nextIndex }))
  }, [nav, applyNavSnapshot])

  const goForward = useCallback(() => {
    if (nav.index >= nav.list.length - 1) return
    const nextIndex = nav.index + 1
    applyNavSnapshot(nav.list[nextIndex])
    setNav((prev) => ({ ...prev, index: nextIndex }))
  }, [nav, applyNavSnapshot])

  const canGoBack = nav.index > 0
  const canGoForward = nav.index < nav.list.length - 1

  // In Electron the main process forwards shortcuts from whichever webContents
  // has focus; renderer-side handlers are only for dev:web (no main process).
  const isBrowserMode = window.api?.platform === 'browser'

  // Bindable keyboard shortcuts.
  useKeybinding('open-command-palette', useCallback(() => { if (isBrowserMode) setShowCommandPalette(true) }, [isBrowserMode]))
  useKeybinding('open-settings', useCallback(() => { if (isBrowserMode) setShowSettings((v) => !v) }, [isBrowserMode]))
  useKeybinding('new-session', useCallback(() => {
    if (isBrowserMode) {
      setShowSettings(false)
      setMainView('chat')
      startNewChat()
    }
  }, [isBrowserMode, startNewChat]))
  useKeybinding('toggle-sidebar', useCallback(() => { if (isBrowserMode) toggleActiveSidebar() }, [isBrowserMode, toggleActiveSidebar]))

  // Electron: main-process forwarding dispatches every bound action here.
  useEffect(() => {
    return window.api?.onAppShortcut?.((id) => {
      if (id === 'toggle-sidebar') toggleActiveSidebar()
      else if (id === 'open-command-palette') setShowCommandPalette(true)
      else if (id === 'open-settings') setShowSettings((v) => !v)
      else if (id === 'new-session') {
        setShowSettings(false)
        setMainView('chat')
        startNewChat()
      }
    })
  }, [toggleActiveSidebar, startNewChat])

  // Escape closes modals. Cmd+[ / Cmd+] mirror the header's back/forward
  // buttons — the modifier means this never collides with typing literal
  // bracket characters in a focused input.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (showCommandPalette) setShowCommandPalette(false)
        if (showSettings) setShowSettings(false)
      } else if (e.metaKey && e.key === '[') {
        e.preventDefault()
        goBack()
      } else if (e.metaKey && e.key === ']') {
        e.preventDefault()
        goForward()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSettings, showCommandPalette, goBack, goForward])

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
      <Sidebar
        onOpenSettings={() => setShowSettings(true)}
        onToggle={toggleSidebar}
        open={sidebarOpen}
        mainView={mainView}
        onMainViewChange={setMainView}
        onSidebarWidthChange={commitSidebarWidth}
      />
      <div className="workspace">
        <div className="workspace-top">
          <div className="main-column">
            {mainView === 'chat' ? (
              <ChatArea
                onToggleSidebar={toggleSidebar}
                onOpenSettings={() => setShowSettings(true)}
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                onGoBack={goBack}
                onGoForward={goForward}
              />
            ) : (
              <AutomationView
                onToggleSidebar={toggleSidebar}
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                onGoBack={goBack}
                onGoForward={goForward}
              />
            )}
          </div>
          <RightPanel />
        </div>
        <BottomTerminal />
      </div>
      {showSettings && (
        <Settings
          onSidebarWidthChange={commitSidebarWidth}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={goBack}
          onGoForward={goForward}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onOpenSettings={() => setShowSettings(true)}
          onMainViewChange={setMainView}
        />
      )}
      <PermissionDialog />
      {appVersion && <div className="app-version">v{appVersion}</div>}
    </div>
  )
}
