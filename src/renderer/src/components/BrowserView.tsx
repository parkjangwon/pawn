import { useState, useRef, useCallback, useEffect } from 'react'

export default function BrowserView(): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [currentUrl, setCurrentUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'mobile'>('desktop')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [logs, setLogs] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [useProxy, setUseProxy] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const isBrowser = typeof window !== 'undefined' && (window as any).api?.platform === 'browser'
  const isElectron = typeof window !== 'undefined' && (window as any).api?.platform !== 'browser' && !!(window as any).api?.browser?.create

  // In Electron mode, create native BrowserView
  useEffect(() => {
    if (!isElectron) return
    const api = (window as any).api
    api.browser.create().catch(() => {})
    return () => { api.browser.destroy().catch(() => {}) }
  }, [isElectron])

  const navigate = useCallback((targetUrl: string): void => {
    let finalUrl = targetUrl.trim()
    if (!finalUrl) return
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl
    }
    setCurrentUrl(finalUrl)
    setUrl(finalUrl)
    setLoading(true)
    setLogs([])
    setLoadError(null)
    setHistory((h) => { h.push(finalUrl); return h.slice(-50) })
    setHistoryIndex((i) => i + 1)
  }, [])

  const handleGo = (): void => navigate(url)
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleGo()
  }

  const goBack = (): void => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1
      setHistoryIndex(newIdx)
      const prev = history[newIdx]
      setCurrentUrl(prev); setUrl(prev); setLoading(true); setLogs([]); setLoadError(null)
    }
  }

  const goForward = (): void => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1
      setHistoryIndex(newIdx)
      const next = history[newIdx]
      setCurrentUrl(next); setUrl(next); setLoading(true); setLogs([]); setLoadError(null)
    }
  }

  const refresh = (): void => {
    if (currentUrl) navigate(currentUrl)
  }

  // Expose browser API
  useEffect(() => {
    (window as any).__pawnBrowser = {
      navigate,
      refresh,
      evaluate: (code: string): Promise<unknown> => {
        if (isElectron) { return (window as any).api.browser.eval(code).then((r: any) => r.result) }
        return new Promise((resolve, reject) => {
          try {
            if (!iframeRef.current?.contentWindow) return reject('no iframe')
            const w = iframeRef.current.contentWindow as any
            const result = w.eval ? w.eval(code) : undefined
            resolve(result)
          } catch (e) { reject(e) }
        })
      },
      getUrl: () => currentUrl,
      getLogs: () => [...logs],
      setDevice: (mode: 'desktop' | 'mobile') => setDeviceMode(mode)
    }
    return () => { delete (window as any).__pawnBrowser }
  }, [currentUrl, logs, navigate, refresh, isElectron])

  // Build the src URL
  const iframeSrc = currentUrl && isBrowser && (useProxy || devMode)
    ? `/api/browser/proxy?url=${encodeURIComponent(currentUrl)}`
    : currentUrl

  const displayUrl = currentUrl ? currentUrl.replace(/^https?:\/\//, '') : ''

  return (
    <div className="rp-browser">
      {/* Navigation bar */}
      <div className="rp-browser-toolbar">
        <div className="rp-browser-nav">
          <button className="rp-browser-navbtn" onClick={goBack} disabled={historyIndex <= 0} title="Back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button className="rp-browser-navbtn" onClick={goForward} disabled={historyIndex >= history.length - 1} title="Forward">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          <button className="rp-browser-navbtn" onClick={refresh} title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          </button>
        </div>

        {/* URL bar */}
        <div className="rp-browser-urlbar">
          <input className="rp-browser-input" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={handleKeyDown} placeholder="Enter URL..." onFocus={(e) => e.target.select()} />
          <button className="rp-browser-go" onClick={handleGo} title="Go">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>
          </button>
        </div>

        {/* Mode toggles */}
        <div className="rp-browser-modes">
          <button className={`rp-browser-modebtn ${useProxy ? 'active' : ''}`} onClick={() => setUseProxy(!useProxy)} title="Proxy mode (bypass X-Frame-Options)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
          </button>
          <button className={`rp-browser-modebtn ${deviceMode === 'mobile' ? 'active' : ''}`} onClick={() => setDeviceMode(deviceMode === 'mobile' ? 'desktop' : 'mobile')} title="Mobile view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18" /></svg>
          </button>
          <button className={`rp-browser-modebtn ${devMode ? 'active' : ''}`} onClick={() => setDevMode(!devMode)} title="Dev tools">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div className={`rp-browser-viewport ${deviceMode}`}>
        {currentUrl ? (
          <>
            {loading && <div className="rp-browser-loading"><div className="rp-browser-spinner" /></div>}
            {loadError && (
              <div className="rp-browser-error-overlay">
                <div className="rp-browser-error">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  <div className="rp-browser-error-text">{loadError}</div>
                  <button className="rp-browser-error-btn" onClick={() => setUseProxy(true)}>Enable proxy mode</button>
                  <button className="rp-browser-error-btn secondary" onClick={() => { setUseProxy(true); navigate(currentUrl) }}>Retry with proxy</button>
                  <button className="rp-browser-error-btn secondary" onClick={() => window.open(currentUrl, '_blank')}>Open externally</button>
                </div>
              </div>
            )}
            <iframe ref={iframeRef} className="rp-browser-frame" src={iframeSrc} onLoad={() => { setLoading(false); setLoadError(null) }} sandbox={devMode ? undefined : 'allow-scripts allow-same-origin allow-forms allow-popups'} />
          </>
        ) : (
          <div className="rp-browser-content">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            <span>Enter a URL above to start browsing</span>
          </div>
        )}
      </div>

      {/* Dev console */}
      {devMode && (
        <div className="rp-browser-devtools">
          <div className="rp-browser-devtools-header">
            <span>Console</span>
            <button onClick={() => setLogs([])} title="Clear">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          </div>
          <div className="rp-browser-devtools-body">
            {logs.length === 0 && <div className="rp-browser-devtools-empty">No console messages yet</div>}
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
