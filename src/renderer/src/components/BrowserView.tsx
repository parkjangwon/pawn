import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  ChevronLeft,
  ChevronRight,
  CircleX,
  CodeXml,
  CornerUpLeft,
  Crosshair,
  Globe,
  RefreshCw,
  Sun,
  Trash2
} from 'lucide-react'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { uid } from '../utils/uid'
import {
  formatBrowserSelectionBlock,
  type BrowserPickSelection
} from '../utils/browserFeedback'
import type { ChatAttachment } from '../utils/attachments'
import type { BrowserTabInfo } from '../agent/browser'

/**
 * The panel showing the SAME embedded browser the agent tools drive (see
 * agent/browser.ts + the main-process WebContentsView in src/main/index.ts).
 * There is exactly one native page; this component only positions it and
 * reflects its navigation state — it never owns separate browser state, or the
 * agent and the user would end up looking at two different pages.
 *
 * In dev:web mode there is no WebContentsView to host, so it falls back to a
 * sandboxed iframe purely for manual browsing; agent browser tools report
 * "desktop app only" there (see agent/tools.ts requireBrowser()).
 */
export default function BrowserView(): React.JSX.Element {
  const isElectron = typeof window !== 'undefined' && window.api?.platform !== 'browser' && !!window.api?.browser?.ensure

  return isElectron ? <NativeBrowserView /> : <IframeBrowserView />
}

// --- Electron: native WebContentsView, positioned over a placeholder div ---

function NativeBrowserView(): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState('')
  const [state, setState] = useState<{ url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }>({
    url: '', title: '', loading: false, canGoBack: false, canGoForward: false
  })
  const [error, setError] = useState<string | null>(null)
  const [showConsole, setShowConsole] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [pickActive, setPickActive] = useState(false)
  const [sending, setSending] = useState(false)
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const syncBounds = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    window.api.browser.setBounds(rect.left, rect.top, rect.width, rect.height)
  }, [])

  // Create (or reuse — the agent may have created it already) the native view,
  // show it, and start positioning it over the placeholder. Hide + stop on
  // unmount so switching to another right-panel tab doesn't leave the page
  // floating over the new tab's content.
  useEffect(() => {
    let cancelled = false
    window.api.browser.ensure().then((res) => {
      if (cancelled) return
      if (res.error) { setError(res.error); return }
      // A full-screen overlay (Settings) cannot be covered by the native
      // WebContentsView, so skip showing the page while one is open. The
      // overlay's close path restores visibility via RightPanel.
      if (!(window as any).__fullscreenOverlayOpen) {
        window.api.browser.setVisible(true)
      }
      syncBounds()
      window.api.browser.state().then((s) => {
        if (cancelled || !s.created) return
        setState({
          url: s.url || '', title: s.title || '', loading: s.loading === true,
          canGoBack: s.canGoBack === true, canGoForward: s.canGoForward === true
        })
        setUrl(s.url || '')
        setTabs((s.tabs as BrowserTabInfo[]) || [])
        setActiveTabId(s.activeTabId ?? null)
      })
    })

    const off = window.api.browser.onEvent((data) => {
      if (data.type === 'error') {
        setError(`${data.description || 'Failed to load'} (${data.url || ''})`)
        return
      }
      setError(null)
      setState({
        url: (data.url as string) || '', title: (data.title as string) || '',
        loading: data.loading === true, canGoBack: data.canGoBack === true, canGoForward: data.canGoForward === true
      })
      if (data.type !== 'title') setUrl((data.url as string) || '')
      if (Array.isArray(data.tabs)) setTabs(data.tabs as BrowserTabInfo[])
      if (data.activeTabId !== undefined) setActiveTabId(data.activeTabId as string | null)
    })

    return () => {
      cancelled = true
      off()
      window.api.browser.setVisible(false)
    }
  }, [syncBounds])

  // Keep the native view aligned with the placeholder across window resizes,
  // sidebar toggles, and right-panel drag-resize — all of which change this
  // element's rect without the element itself re-mounting.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(syncBounds)
    observer.observe(el)
    window.addEventListener('resize', syncBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [syncBounds])

  useEffect(() => {
    if (!showConsole) return
    let cancelled = false
    const pull = (): void => {
      window.api.browser
        .logs()
        .then((l) => { if (!cancelled) setLogs(l) })
        .catch(() => {})
    }
    pull()
    const id = setInterval(pull, 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [showConsole])

  // Pick mode: injects the element/text highlighter + speech bubble into the
  // page. The bubble submits with Enter (Shift+Enter = newline) and we poll for
  // the ready flag, then forward the selection + comment to the main chat.
  useEffect(() => {
    if (!pickActive) return
    let cancelled = false
    void window.api.browser
      .pickStart(
        t('rightPanel.browser.feedbackPlaceholder'),
        t('rightPanel.browser.bubbleHint')
      )
      .catch(() => {})
    const poll = async (): Promise<void> => {
      const s = await window.api.browser.pickState().catch(() => null)
      if (cancelled || !s) return
      if (s.ready && s.selection && !sendingRef.current) {
        await sendFeedback(s.selection as BrowserPickSelection, s.feedback)
        if (!cancelled) void window.api.browser.pickClear().catch(() => {})
      }
    }
    const id = window.setInterval(() => void poll(), 400)
    return () => {
      cancelled = true
      window.clearInterval(id)
      void window.api.browser.pickStop().catch(() => {})
    }
  }, [pickActive])

  const navigate = async (target: string): Promise<void> => {
    const t = target.trim()
    if (!t) return
    setError(null)
    try {
      const res = await window.api.browser.navigate(t)
      if (res.error) setError(res.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const switchTab = async (id: string): Promise<void> => {
    try {
      const res = await window.api.browser.tabSwitch(id)
      if (res.error) setError(res.error)
    } catch (err) {
      setError(t('rightPanel.browser.tabSwitchFailed', { error: String(err) }))
    }
  }

  const closeTab = async (id: string): Promise<void> => {
    try {
      const res = await window.api.browser.tabClose(id)
      if (res.error) setError(res.error)
    } catch (err) {
      setError(t('rightPanel.browser.tabCloseFailed', { error: String(err) }))
    }
  }

  const newTab = async (): Promise<void> => {
    try {
      const res = await window.api.browser.tabCreate()
      if (res.error) { setError(res.error); return }
      if (res.tabs) setTabs(res.tabs as BrowserTabInfo[])
      if (res.activeTabId !== undefined) setActiveTabId(res.activeTabId as string | null)
      setUrl('')
      setError(null)
      urlInputRef.current?.focus()
    } catch (err) {
      setError(t('rightPanel.browser.newTabFailed', { error: String(err) }))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') navigate(url)
  }

  const sendingRef = useRef(false)
  const sendFeedback = async (selection: BrowserPickSelection, comment: string): Promise<void> => {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      const app = useAppStore.getState()
      let projectId = app.activeProjectId
      let sessionId = app.activeSessionId
      if (!projectId || !sessionId) {
        projectId = app.ensureGeneralProject()
        sessionId = app.startNewChat(comment.trim().slice(0, 40) || 'Browser feedback')
      }
      const block = formatBrowserSelectionBlock(selection, comment)
      const attachments: ChatAttachment[] = []
      // Screenshot while the highlight overlay is still visible so the agent
      // sees exactly which area the user pointed at.
      await window.api.browser.hideCursor().catch(() => {})
      const shot = await window.api.browser.screenshot().catch(() => null)
      if (shot && !shot.error && shot.dataUrl) {
        attachments.push({
          id: uid('sel-'),
          name: 'selection.png',
          kind: 'image',
          dataUrl: shot.dataUrl,
          bytes: shot.dataUrl.length
        })
      }
      const mode = useChatStore.getState().isStreaming ? 'steer' : 'queue'
      useChatStore.getState().sendMessage(projectId, sessionId, block, mode, attachments)
      setPickActive(false)
    } catch (err) {
      // Poll callers fire this with void — a failure must not escape as an
      // unhandled rejection every tick.
      setError(err instanceof Error ? err.message : String(err))
      setPickActive(false)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <div className="rp-browser">
      <div className="rp-browser-tabbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`rp-browser-tab${tab.id === activeTabId ? ' active' : ''}`}
            onClick={() => void switchTab(tab.id)}
            title={tab.url || tab.title || tab.id}
          >
            <span className="rp-browser-tab-title">{tab.title || tab.url || t('rightPanel.browser.newTab')}</span>
            <button
              className="rp-browser-tab-close"
              onClick={(e) => { e.stopPropagation(); void closeTab(tab.id) }}
              title={t('rightPanel.browser.closeTab')}
              aria-label={t('rightPanel.browser.closeTab')}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="rp-browser-tab-add"
          onClick={() => void newTab()}
          title={t('rightPanel.browser.newTab')}
          aria-label={t('rightPanel.browser.newTab')}
        >
          +
        </button>
      </div>
      <div className="rp-browser-toolbar">
        <div className="rp-browser-nav">
          <button className="rp-browser-navbtn" onClick={() => window.api.browser.back()} disabled={!state.canGoBack} title={t('rightPanel.browser.back')}>
            <ChevronLeft size={14} />
          </button>
          <button className="rp-browser-navbtn" onClick={() => window.api.browser.reload()} title={t('rightPanel.browser.reload')}>
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="rp-browser-urlbar">
          <input
            className="rp-browser-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('rightPanel.browser.enterUrl')}
            onFocus={(e) => e.target.select()}
            ref={urlInputRef}
          />
          <button className="rp-browser-go" onClick={() => navigate(url)} title={t('rightPanel.browser.go')}>
            <CornerUpLeft size={14} />
          </button>
        </div>

        <div className="rp-browser-modes">
          <button
            className={`rp-browser-modebtn ${pickActive ? 'active' : ''}`}
            onClick={() => setPickActive((a) => !a)}
            disabled={!state.url || sending}
            title={t('rightPanel.browser.pick')}
          >
            <Crosshair size={14} />
          </button>
          <button className={`rp-browser-modebtn ${showConsole ? 'active' : ''}`} onClick={() => setShowConsole(!showConsole)} title={t('rightPanel.browser.console')}>
            <CodeXml size={14} />
          </button>
          <button className="rp-browser-modebtn" onClick={() => window.api.browser.devtools()} title={t('rightPanel.browser.devtools')}>
            <AppWindow size={14} />
          </button>
        </div>
      </div>

      <div className="rp-browser-viewport desktop">
        {/* This div is a placeholder: its screen rect tells the main process where
            to place the real WebContentsView. Nothing is ever painted inside it. */}
        <div ref={containerRef} className="rp-browser-native-slot" />
        {state.loading && <div className="rp-browser-loading"><div className="rp-browser-spinner" /></div>}
        {!state.url && !error && (
          <div className="rp-browser-content">
            <Globe size={32} opacity={0.3} />
            <span>{t('rightPanel.browser.emptyHint')}</span>
          </div>
        )}
        {error && (
          <div className="rp-browser-error-overlay">
            <div className="rp-browser-error">
              <CircleX size={32} />
              <div className="rp-browser-error-text">{error}</div>
              <button className="rp-browser-error-btn secondary" onClick={() => window.api.browser.reload()}>{t('rightPanel.browser.retry')}</button>
            </div>
          </div>
        )}
      </div>

      {pickActive && (
        <div className="rp-browser-pick-hint">
          <span className="rp-browser-pick-dot" />
          {t('rightPanel.browser.pickHint')}
        </div>
      )}

      {showConsole && (
        <div className="rp-browser-devtools">
          <div className="rp-browser-devtools-header">
            <span>{t('rightPanel.browser.console')}</span>
            <button onClick={() => setLogs([])} title={t('rightPanel.browser.clear')}>
              <Trash2 size={12} />
            </button>
          </div>
          <div className="rp-browser-devtools-body">
            {logs.length === 0 && <div className="rp-browser-devtools-empty">{t('rightPanel.browser.noConsole')}</div>}
            {logs.map((log, i) => (
              <div key={i} className={`rp-browser-log rp-browser-log-${log.startsWith('[error]') ? 'error' : log.startsWith('[warn]') ? 'warn' : 'info'}`}>
                <span className="rp-browser-log-num">{i + 1}</span>
                <span className="rp-browser-log-text">{log}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Browser (dev:web) fallback: sandboxed iframe, manual browsing only ---

function IframeBrowserView(): React.JSX.Element {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [currentUrl, setCurrentUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [useProxy, setUseProxy] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const navigate = useCallback((targetUrl: string): void => {
    let finalUrl = targetUrl.trim()
    if (!finalUrl) return
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl
    }
    setCurrentUrl(finalUrl)
    setUrl(finalUrl)
    setLoading(true)
    setLoadError(null)
    setHistory((h) => { const next = [...h.slice(0, historyIndex + 1), finalUrl]; return next.slice(-50) })
    setHistoryIndex((i) => i + 1)
  }, [historyIndex])

  const handleGo = (): void => navigate(url)
  const handleKeyDown = (e: React.KeyboardEvent): void => { if (e.key === 'Enter') handleGo() }

  const goBack = (): void => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1
      setHistoryIndex(idx)
      setCurrentUrl(history[idx]); setUrl(history[idx]); setLoading(true); setLoadError(null)
    }
  }
  const goForward = (): void => {
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1
      setHistoryIndex(idx)
      setCurrentUrl(history[idx]); setUrl(history[idx]); setLoading(true); setLoadError(null)
    }
  }
  const refresh = (): void => { if (currentUrl) navigate(currentUrl) }

  const iframeSrc = currentUrl && (useProxy || devMode)
    ? `/api/browser/proxy?url=${encodeURIComponent(currentUrl)}`
    : currentUrl

  return (
    <div className="rp-browser">
      <div className="rp-browser-toolbar">
        <div className="rp-browser-nav">
          <button className="rp-browser-navbtn" onClick={goBack} disabled={historyIndex <= 0} title={t('rightPanel.browser.back')}>
            <ChevronLeft size={14} />
          </button>
          <button className="rp-browser-navbtn" onClick={goForward} disabled={historyIndex >= history.length - 1} title={t('rightPanel.browser.forward')}>
            <ChevronRight size={14} />
          </button>
          <button className="rp-browser-navbtn" onClick={refresh} title={t('rightPanel.browser.refresh')}>
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="rp-browser-urlbar">
          <input className="rp-browser-input" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={handleKeyDown} placeholder={t('rightPanel.browser.enterUrl')} onFocus={(e) => e.target.select()} />
          <button className="rp-browser-go" onClick={handleGo} title={t('rightPanel.browser.go')}>
            <CornerUpLeft size={14} />
          </button>
        </div>

        <div className="rp-browser-modes">
          <button className={`rp-browser-modebtn ${useProxy ? 'active' : ''}`} onClick={() => setUseProxy(!useProxy)} title={t('rightPanel.browser.proxyMode')}>
            <Sun size={14} />
          </button>
        </div>
      </div>

      <div className="rp-browser-viewport desktop">
        {currentUrl ? (
          <>
            {loading && <div className="rp-browser-loading"><div className="rp-browser-spinner" /></div>}
            {loadError && (
              <div className="rp-browser-error-overlay">
                <div className="rp-browser-error">
                  <CircleX size={32} />
                  <div className="rp-browser-error-text">{loadError}</div>
                  <button className="rp-browser-error-btn" onClick={() => setUseProxy(true)}>{t('rightPanel.browser.enableProxy')}</button>
                </div>
              </div>
            )}
            <iframe ref={iframeRef} className="rp-browser-frame" src={iframeSrc} onLoad={() => { setLoading(false); setLoadError(null) }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
          </>
        ) : (
          <div className="rp-browser-content">
            <Globe size={32} opacity={0.3} />
            <span>{t('rightPanel.browser.emptyHintWeb')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
