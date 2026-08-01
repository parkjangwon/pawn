import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKeybindingsStore, formatCombo } from '../stores/keybindings'

interface ChatHeaderProps {
  onToggleSidebar: () => void
  projectName?: string
  gitBranch?: string | null
  projectPath?: string
}

interface ScriptItem {
  name: string
}

interface OpenAppItem {
  id: string
  label: string
  appName?: string
}

const APP_PRESETS: OpenAppItem[] = [
  { id: 'terminal', label: 'Terminal', appName: 'Terminal' },
  { id: 'vscode', label: 'Visual Studio Code', appName: 'Visual Studio Code' },
  { id: 'cursor', label: 'Cursor', appName: 'Cursor' },
  { id: 'intellij', label: 'IntelliJ IDEA', appName: 'IntelliJ IDEA' },
  { id: 'sublime', label: 'Sublime Text', appName: 'Sublime Text' },
  { id: 'finder', label: 'Show in Finder', appName: 'Finder' }
]

export default function ChatHeader({ onToggleSidebar, projectName, gitBranch, projectPath }: ChatHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  const bindings = useKeybindingsStore((s) => s.bindings)
  const panelShortcut = formatCombo(bindings['toggle-right-panel'])
  const sidebarShortcut = formatCombo(bindings['toggle-sidebar'])

  const [showScriptMenu, setShowScriptMenu] = useState(false)
  const [showOpenMenu, setShowOpenMenu] = useState(false)
  const [scripts, setScripts] = useState<ScriptItem[]>([])
  const [availableApps, setAvailableApps] = useState<OpenAppItem[]>([])
  const [runningScript, setRunningScript] = useState<string | null>(null)

  const canRunScript = Boolean(projectPath) && scripts.length > 0

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('.chat-header-action-group')) {
        setShowScriptMenu(false)
        setShowOpenMenu(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  useEffect(() => {
    if (!projectPath) {
      setScripts([])
      return
    }
    let cancelled = false
    const loadScripts = async (): Promise<void> => {
      const file = await window.api.fs.readFile(`${projectPath}/package.json`)
      if (cancelled || typeof file !== 'string') {
        if (!cancelled) setScripts([])
        return
      }
      try {
        const parsed = JSON.parse(file) as { scripts?: Record<string, string> }
        const names = Object.keys(parsed.scripts || {})
        if (!cancelled) setScripts(names.map((name) => ({ name })))
      } catch {
        if (!cancelled) setScripts([])
      }
    }
    void loadScripts()
    return () => { cancelled = true }
  }, [projectPath])

  useEffect(() => {
    let cancelled = false
    const detectApps = async (): Promise<void> => {
      const base = APP_PRESETS.filter((app) => app.id === 'finder')
      if (window.api.platform !== 'darwin') {
        if (!cancelled) setAvailableApps(base)
        return
      }

      const roots = ['/Applications', `${(await window.api.fs.homeDir()) || ''}/Applications`].filter(Boolean)
      const found: OpenAppItem[] = []
      for (const item of APP_PRESETS) {
        if (item.id === 'finder') continue
        const appName = item.appName || item.label
        let exists = false
        for (const root of roots) {
          const ok = await window.api.fs.exists(`${root}/${appName}.app`)
          if (ok) {
            exists = true
            break
          }
        }
        if (exists) found.push(item)
      }
      if (!cancelled) setAvailableApps([...found, ...base])
    }
    void detectApps()
    return () => { cancelled = true }
  }, [])

  const openTarget = async (item: OpenAppItem): Promise<void> => {
    if (!projectPath) return
    const app = item.id === 'finder' ? 'finder' : (item.appName || item.label)
    await window.api.workspace.openIn(projectPath, app)
    setShowOpenMenu(false)
  }

  const runScript = async (name: string): Promise<void> => {
    if (!projectPath) return
    const packageManager = (await window.api.fs.exists(`${projectPath}/pnpm-lock.yaml`))
      ? 'pnpm'
      : (await window.api.fs.exists(`${projectPath}/yarn.lock`))
        ? 'yarn'
        : 'npm'
    setRunningScript(name)
    const res = await window.api.workspace.runScript(projectPath, name, packageManager)
    if (res.error) {
      window.api.notification?.send('Script failed', res.error)
    } else {
      window.api.notification?.send('Script started', `${packageManager} run ${name}`)
      try { (window as any).__openRightPanelTab?.('terminal') } catch {}
    }
    setRunningScript(null)
    setShowScriptMenu(false)
  }

  const openButtonLabel = useMemo(() => (availableApps.length > 0 ? t('chatHeader.openIn') : t('chatHeader.open')), [availableApps.length, t])

  return (
    <div className="chat-header chat-header-shell">
      <div className="chat-header-left">
        <button className="sidebar-toggle-btn close-sidebar-btn" onClick={onToggleSidebar} aria-label={t('contextBar.openSidebar')} title={`${t('contextBar.openSidebar')} (${sidebarShortcut})`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        <div className="chat-header-title-block">
          <span className="chat-header-title">{projectName || t('contextBar.noProject')}</span>
          {gitBranch && <span className="chat-header-branch">• {gitBranch}</span>}
        </div>
      </div>

      <div className="chat-header-right">
        <div className="chat-header-action-group">
          <button className="chat-header-btn" disabled={!canRunScript || !!runningScript} onClick={() => { setShowScriptMenu((v) => !v); setShowOpenMenu(false) }}>
            <span>{runningScript ? `${t('chatHeader.running')} ${runningScript}` : t('chatHeader.run')}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {showScriptMenu && (
            <div className="chat-header-menu">
              {scripts.map((s) => (
                <button key={s.name} className="chat-header-menu-item" onClick={() => void runScript(s.name)}>
                  {s.name}
                </button>
              ))}
              {scripts.length === 0 && <div className="chat-header-menu-empty">{t('chatHeader.noScripts')}</div>}
            </div>
          )}
        </div>

        <div className="chat-header-action-group">
          <button className="chat-header-btn chat-header-btn-icon" disabled={!projectPath} onClick={() => { setShowOpenMenu((v) => !v); setShowScriptMenu(false) }} title={openButtonLabel} aria-label={openButtonLabel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h6l2 2h10v8a2 2 0 0 1-2 2H3z" /><path d="M3 7a2 2 0 0 1 2-2h4l2 2" /></svg>
          </button>
          {showOpenMenu && (
            <div className="chat-header-menu">
              {availableApps.map((app) => (
                <button key={app.id} className="chat-header-menu-item" onClick={() => void openTarget(app)}>
                  {app.label}
                </button>
              ))}
              {availableApps.length === 0 && <div className="chat-header-menu-empty">{t('chatHeader.noApps')}</div>}
            </div>
          )}
        </div>

        <button className="sidebar-toggle-btn right-panel-toggle" onClick={() => (window as any).__toggleRightPanel?.()} aria-label={t('contextBar.toggleRightPanel')} title={`${t('contextBar.toggleRightPanel')} (${panelShortcut})`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      </div>
    </div>
  )
}
