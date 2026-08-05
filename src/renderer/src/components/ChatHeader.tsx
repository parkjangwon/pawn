import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKeybindingsStore, formatCombo } from '../stores/keybindings'
import NavControls from './NavControls'

interface ChatHeaderProps {
  onToggleSidebar: () => void
  projectName?: string
  gitBranch?: string | null
  projectPath?: string
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
}

interface ScriptItem {
  name: string
}

interface OpenAppItem {
  id: string
  label: string
  appName?: string
  /** Extra names to try (in order) if `appName`/`label` isn't found — e.g. a
   *  free/Community edition that installs under a different .app name. */
  altNames?: string[]
  /** Resolved .app bundle path, used to fetch its real icon (macOS only). */
  iconPath?: string
}

// Fixed system app locations that aren't under /Applications, so the normal
// "does <appName>.app exist under a root" scan would never find them.
const FIXED_APP_PATHS: Record<string, string> = {
  finder: '/System/Library/CoreServices/Finder.app'
}

const APP_PRESETS: OpenAppItem[] = [
  { id: 'terminal', label: 'Terminal', appName: 'Terminal' },
  // General-purpose / AI-assisted editors
  { id: 'vscode', label: 'Visual Studio Code', appName: 'Visual Studio Code' },
  { id: 'vscode-insiders', label: 'Visual Studio Code - Insiders', appName: 'Visual Studio Code - Insiders' },
  { id: 'vscodium', label: 'VSCodium', appName: 'VSCodium' },
  { id: 'cursor', label: 'Cursor', appName: 'Cursor' },
  { id: 'windsurf', label: 'Windsurf', appName: 'Windsurf' },
  { id: 'trae', label: 'Trae', appName: 'Trae' },
  { id: 'zed', label: 'Zed', appName: 'Zed' },
  { id: 'nova', label: 'Nova', appName: 'Nova' },
  { id: 'sublime', label: 'Sublime Text', appName: 'Sublime Text' },
  { id: 'textmate', label: 'TextMate', appName: 'TextMate' },
  { id: 'bbedit', label: 'BBEdit', appName: 'BBEdit' },
  { id: 'macvim', label: 'MacVim', appName: 'MacVim' },
  { id: 'emacs', label: 'Emacs', appName: 'Emacs' },
  // Apple / mobile platforms
  { id: 'xcode', label: 'Xcode', appName: 'Xcode' },
  { id: 'android-studio', label: 'Android Studio', appName: 'Android Studio' },
  // JetBrains suite
  { id: 'intellij', label: 'IntelliJ IDEA', appName: 'IntelliJ IDEA' },
  { id: 'webstorm', label: 'WebStorm', appName: 'WebStorm' },
  { id: 'pycharm', label: 'PyCharm', appName: 'PyCharm', altNames: ['PyCharm CE'] },
  { id: 'clion', label: 'CLion', appName: 'CLion' },
  { id: 'goland', label: 'GoLand', appName: 'GoLand' },
  { id: 'phpstorm', label: 'PhpStorm', appName: 'PhpStorm' },
  { id: 'rubymine', label: 'RubyMine', appName: 'RubyMine' },
  { id: 'datagrip', label: 'DataGrip', appName: 'DataGrip' },
  { id: 'rider', label: 'Rider', appName: 'Rider' },
  { id: 'fleet', label: 'Fleet', appName: 'Fleet' },
  { id: 'finder', label: 'Show in Finder', appName: 'Finder' }
]

export default function ChatHeader({
  onToggleSidebar, projectName, gitBranch, projectPath, canGoBack, canGoForward, onGoBack, onGoForward
}: ChatHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  const bindings = useKeybindingsStore((s) => s.bindings)
  const panelShortcut = formatCombo(bindings['toggle-right-panel'])
  const sidebarShortcut = formatCombo(bindings['toggle-sidebar'])

  const [showScriptMenu, setShowScriptMenu] = useState(false)
  const [showOpenMenu, setShowOpenMenu] = useState(false)
  const [scripts, setScripts] = useState<ScriptItem[]>([])
  const [availableApps, setAvailableApps] = useState<OpenAppItem[]>([])
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
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
      const base = APP_PRESETS
        .filter((app) => app.id === 'finder')
        .map((app) => ({ ...app, iconPath: FIXED_APP_PATHS[app.id] }))
      if (window.api.platform !== 'darwin') {
        if (!cancelled) setAvailableApps(base)
        return
      }

      const roots = ['/Applications', `${(await window.api.fs.homeDir()) || ''}/Applications`].filter(Boolean)
      // The preset list is long enough now that checking it item-by-item,
      // root-by-root would be a noticeably slow chain of IPC round-trips —
      // fs.exists is a plain, side-effect-free filesystem check, so unlike
      // the icon lookup there's no reason not to run these concurrently.
      const detected = await Promise.all(
        APP_PRESETS
          .filter((item) => item.id !== 'finder')
          .map(async (item): Promise<OpenAppItem | null> => {
            const candidates = [item.appName || item.label, ...(item.altNames || [])]
            for (const name of candidates) {
              for (const root of roots) {
                const path = `${root}/${name}.app`
                if (await window.api.fs.exists(path)) {
                  return { ...item, appName: name, iconPath: path }
                }
              }
            }
            return null
          })
      )
      const found = detected.filter((item): item is OpenAppItem => item !== null)
      if (!cancelled) setAvailableApps([...found, ...base])
    }
    void detectApps()
    return () => { cancelled = true }
  }, [])

  // Real app icons instead of a generic glyph — best-effort, desktop only.
  // Fetched one at a time: firing all of them concurrently via Promise.all
  // made Electron's underlying NSWorkspace icon lookup return the same
  // corrupted/generic icon for every app instead of each one's real icon.
  useEffect(() => {
    if (window.api.platform !== 'darwin' || !window.api.workspace.getAppIcon) return
    let cancelled = false
    const targets = availableApps.filter((a) => a.iconPath && !appIcons[a.id])
    if (targets.length === 0) return
    const run = async (): Promise<void> => {
      for (const a of targets) {
        if (cancelled) return
        const res = await window.api.workspace.getAppIcon(a.iconPath!).catch(() => null)
        if (!cancelled && res?.dataUrl) {
          setAppIcons((prev) => ({ ...prev, [a.id]: res.dataUrl! }))
        }
      }
    }
    void run()
    return () => { cancelled = true }
  }, [availableApps, appIcons])

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
      window.api.notification?.send(t('notifications.scriptFailed'), res.error)
    } else {
      window.api.notification?.send(t('notifications.scriptStarted'), `${packageManager} run ${name}`)
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
        <NavControls canGoBack={canGoBack} canGoForward={canGoForward} onBack={onGoBack} onForward={onGoForward} />
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
          <button className="chat-header-btn" disabled={!projectPath} onClick={() => { setShowOpenMenu((v) => !v); setShowScriptMenu(false) }} title={openButtonLabel} aria-label={openButtonLabel}>
            <span>{openButtonLabel}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {showOpenMenu && (
            <div className="chat-header-menu">
              {availableApps.map((app) => (
                <button key={app.id} className="chat-header-menu-item" onClick={() => void openTarget(app)}>
                  {appIcons[app.id] ? (
                    <img className="chat-header-menu-item-icon" src={appIcons[app.id]} alt="" />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="chat-header-menu-item-icon">
                      <rect x="3" y="3" width="18" height="18" rx="4" />
                    </svg>
                  )}
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
