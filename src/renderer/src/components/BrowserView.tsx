import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { uid } from '../utils/uid'
import {
  formatBrowserSelectionBlock,
  type BrowserPickSelection
} from '../utils/browserFeedback'
import type { ChatAttachment } from '../utils/attachments'

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
      window.api.browser.setVisible(true)
      syncBounds()
      window.api.browser.state().then((s) => {
        if (cancelled || !s.created) return
        setState({
          url: s.url || '', title: s.title || '', loading: s.loading === true,
          canGoBack: s.canGoBack === true, canGoForward: s.canGoForward === true
        })
        setUrl(s.url || '')
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
      window.api.browser.logs().then((l) => { if (!cancelled) setLogs(l) })
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
    const res = await window.api.browser.navigate(t)
    if (res.error) setError(res.error)
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
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <div className="rp-browser">
      <div className="rp-browser-toolbar">
        <div className="rp-browser-nav">
          <button className="rp-browser-navbtn" onClick={() => window.api.browser.back()} disabled={!state.canGoBack} title={t('rightPanel.browser.back')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button className="rp-browser-navbtn" onClick={() => window.api.browser.reload()} title={t('rightPanel.browser.reload')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
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
          />
          <button className="rp-browser-go" onClick={() => navigate(url)} title={t('rightPanel.browser.go')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>
          </button>
        </div>

        <div className="rp-browser-modes">
          <button
            className={`rp-browser-modebtn ${pickActive ? 'active' : ''}`}
            onClick={() => setPickActive((a) => !a)}
            disabled={!state.url || sending}
            title={t('rightPanel.browser.pick')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="6" />
              <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </button>
          <button className={`rp-browser-modebtn ${showConsole ? 'active' : ''}`} onClick={() => setShowConsole(!showConsole)} title={t('rightPanel.browser.console')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
          </button>
          <button className="rp-browser-modebtn" onClick={() => window.api.browser.devtools()} title={t('rightPanel.browser.devtools')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></svg>
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
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            <span>{t('rightPanel.browser.emptyHint')}</span>
          </div>
        )}
        {error && (
          <div className="rp-browser-error-overlay">
            <div className="rp-browser-error">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button className="rp-browser-navbtn" onClick={goForward} disabled={historyIndex >= history.length - 1} title={t('rightPanel.browser.forward')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          <button className="rp-browser-navbtn" onClick={refresh} title={t('rightPanel.browser.refresh')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          </button>
        </div>

        <div className="rp-browser-urlbar">
          <input className="rp-browser-input" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={handleKeyDown} placeholder={t('rightPanel.browser.enterUrl')} onFocus={(e) => e.target.select()} />
          <button className="rp-browser-go" onClick={handleGo} title={t('rightPanel.browser.go')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>
          </button>
        </div>

        <div className="rp-browser-modes">
          <button className={`rp-browser-modebtn ${useProxy ? 'active' : ''}`} onClick={() => setUseProxy(!useProxy)} title={t('rightPanel.browser.proxyMode')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
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
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  <div className="rp-browser-error-text">{loadError}</div>
                  <button className="rp-browser-error-btn" onClick={() => setUseProxy(true)}>{t('rightPanel.browser.enableProxy')}</button>
                </div>
              </div>
            )}
            <iframe ref={iframeRef} className="rp-browser-frame" src={iframeSrc} onLoad={() => { setLoading(false); setLoadError(null) }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
          </>
        ) : (
          <div className="rp-browser-content">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            <span>{t('rightPanel.browser.emptyHintWeb')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
