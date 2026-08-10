import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import { useKeybinding } from '../stores/keybindings'
import FilesView from './FilesView'
import GitView from './GitView'
import BrowserView from './BrowserView'
import DiffListView from './DiffListView'
import ArtifactsView from './ArtifactsView'
import SubagentsView from './SubagentsView'
import { openFileInPanel } from '../stores/filesPanel'
import './RightPanel.css'

// Terminal lives in BottomTerminal (Codex-style). Callers that still pass
// 'terminal' to the open/close bridges are redirected there.
type TabId = 'files' | 'git' | 'browser' | 'diff' | 'artifacts' | 'agents'
type OpenableId = TabId | 'terminal'

const NOOP = (): void => {}

const TOOL_ICONS: Record<TabId, string> = {
  files: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  git: 'M22 12h-4l-3 9L9 3l-3 9H2',
  browser: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
  diff: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  artifacts: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  agents: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'
}

// The panel is intentionally ephemeral: every launch starts closed and empty.
// Open at half the window width (capped so the chat column keeps breathing
// room); the user can drag the resizer afterwards.
const DEFAULT_WIDTH = Math.min(Math.round(window.innerWidth * 0.5), 640)
const HIDE_MS = 220

export default function RightPanel(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [openTabs, setOpenTabs] = useState<TabId[]>([])
  const [activeTab, setActiveTab] = useState<TabId | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [opening, setOpening] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)
  const customizedWidth = useRef(false)
  const hideTimer = useRef<number | null>(null)
  // The Cmd+B handler below closes over the first render's state, so it must
  // never read `openTabs` directly — mirror it in a ref instead.
  const openTabsRef = useRef<TabId[]>(openTabs)
  const visibleRef = useRef(visible)
  const activeTabRef = useRef<TabId | null>(activeTab)
  const closingRef = useRef(closing)
  const showPickerRef = useRef(showPicker)
  useEffect(() => { openTabsRef.current = openTabs }, [openTabs])
  useEffect(() => { visibleRef.current = visible }, [visible])
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  useEffect(() => { closingRef.current = closing }, [closing])
  useEffect(() => { showPickerRef.current = showPicker }, [showPicker])
  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    document.body.classList.remove('resizing-right-panel')
  }, [])

  const { projects, activeProjectId, activeSessionId } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectPath = getEffectiveProjectPath(activeProject, activeSessionId)

  // Apply panelWidth from state to DOM. The opening render starts at width 0 so
  // the transition slides the panel in; closing animates it back out.
  useLayoutEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      if (!panelRef.current || isResizing.current || closingRef.current) return
      panelRef.current.style.width = panelWidth + 'px'
      panelRef.current.style.minWidth = panelWidth + 'px'
      setOpening(false)
    })
  }, [panelWidth, visible])

  const cancelHide = useCallback((): void => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setClosing(false)
  }, [])

  const requestHide = useCallback((): void => {
    if (closingRef.current) return
    // Hide the embedded browser but keep the page alive so agent runs can resume
    // after the panel is reopened (destroy only on explicit close/quit).
    if (openTabsRef.current.includes('browser')) {
      void window.api.browser?.setVisible?.(false)?.catch?.(() => {})
    }
    setClosing(true)
    hideTimer.current = window.setTimeout(() => {
      setVisible(false)
      setClosing(false)
      hideTimer.current = null
    }, HIDE_MS)
  }, [])

  // Save visibility
  const toggleVisible = useCallback((): void => {
    if (closingRef.current) {
      cancelHide()
      return
    }
    if (visibleRef.current) {
      requestHide()
    } else {
      // Keep the "first open" width in sync with the current window size until
      // the user actually drags the resizer.
      if (!customizedWidth.current) setPanelWidth(Math.round(window.innerWidth * 0.5))
      setOpening(true)
      setVisible(true)
    }
  }, [cancelHide, requestHide])

  // Open a tool as a tab (or switch to it if already open)
  const openTool = (id: TabId): void => {
    // A user-initiated open takes ownership of the browser tab: the agent's
    // auto-close-on-turn-end (chatLoop) must not yank it away.
    if (id === 'browser') {
      ;(window as any).__agentOpenedBrowserPanel = false
    }
    // Only run the slide-in (width 0 -> panelWidth) when the panel is actually
    // closed. The layout effect that resets `opening` fires on a visibility
    // change, so setting it while already visible collapses the panel and
    // never recovers — the tool looks hidden until the next toggle.
    if (!visible) {
      setOpening(true)
      setVisible(true)
    }
    setOpenTabs((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id]
      return next
    })
    setActiveTab(id)
    setShowPicker(false)
  }

  // Switch to a tab
  const switchTab = (id: TabId): void => {
    // User takes ownership of the browser tab by switching to it: the agent's
    // auto-hide-on-turn-end must not yank the panel away mid-viewing.
    if (id === 'browser') {
      ;(window as any).__agentOpenedBrowserPanel = false
    }
    setActiveTab(id)
    setShowPicker(false)
  }

  // The embedded browser is a native WebContentsView that always layers above
  // the renderer DOM, so the tool picker dropdown would be hidden behind the
  // page while the browser tab is active. Hide the native view for the brief
  // moment the picker is open, then bring it back when the picker closes.
  useEffect(() => {
    // Only touch visibility while the browser tab is still active: switching
    // away unmounts BrowserView, whose own cleanup hides the native view.
    if (window.api?.browser?.setVisible && activeTabRef.current === 'browser') {
      void window.api.browser.setVisible(!showPicker).catch(() => {})
    }
  }, [showPicker])

  // Close a tab (shared by the X button and the agent's app_close_tab tool).
  // `activeTab` is read via ref so a window-registered bridge never acts on a
  // stale first-render closure. The ref is updated synchronously so rapid
  // successive closes (same event loop tick) still see fresh state.
  const closeTabById = (id: TabId): void => {
    // Closing the browser tab throws the page away; a fresh view (and a blank
    // page) is created the next time the tab is opened.
    if (id === 'browser') {
      window.api.browser?.destroy?.()?.catch(() => {})
      // Any close of the browser tab clears the agent-opened marker so a stale
      // marker can never auto-close a panel the user reopened later.
      ;(window as any).__agentOpenedBrowserPanel = false
    }
    if (!openTabsRef.current.includes(id)) return
    const next = openTabsRef.current.filter((t) => t !== id)
    openTabsRef.current = next
    setOpenTabs(next)
    if (activeTabRef.current === id) {
      const newActive = next.length > 0 ? next[next.length - 1] : null
      setActiveTab(newActive)
      if (!newActive) requestHide()
    }
  }

  const closeTab = (id: TabId, e: React.MouseEvent): void => {
    e.stopPropagation()
    closeTabById(id)
  }

  // Resize logic. A plain useRef + useLayoutEffect(..., []) would only ever look
  // for the resizer element on the component's FIRST render — and this component
  // returns null whenever the panel is hidden, so on that first render (almost
  // always `visible === false`) the element does not exist yet and the effect
  // finds nothing and never runs again; reopening the panel later never re-runs
  // it. A callback ref fires every time the node actually attaches to (or
  // detaches from) the DOM, which is exactly the panel's open/close lifecycle.
  const resizerCleanup = useRef<(() => void) | null>(null)
  const attachResizer = useCallback((node: HTMLDivElement | null) => {
    resizerCleanup.current?.()
    resizerCleanup.current = null
    if (!node) return

    const startResize = (e: PointerEvent): void => {
      e.preventDefault()
      if (!panelRef.current) return
      node.setPointerCapture?.(e.pointerId)
      isResizing.current = true
      // Width transitions would fight the pointer, making the drag feel springy.
      panelRef.current.style.transition = 'none'
      document.body.classList.add('resizing-right-panel')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (ev: PointerEvent): void => {
        if (!isResizing.current || !panelRef.current) return
        const newWidth = Math.max(200, Math.min(window.innerWidth * 0.7, window.innerWidth - ev.clientX))
        panelRef.current.style.width = newWidth + 'px'
        panelRef.current.style.minWidth = newWidth + 'px'
      }

      const finish = (): void => {
        isResizing.current = false
        customizedWidth.current = true
        if (panelRef.current) panelRef.current.style.transition = ''
        document.body.classList.remove('resizing-right-panel')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (panelRef.current) {
          const finalWidth = panelRef.current.offsetWidth
          setPanelWidth(finalWidth)
        }
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }

    node.addEventListener('pointerdown', startResize)
    resizerCleanup.current = () => node.removeEventListener('pointerdown', startResize)
  }, [toggleVisible])

  // Expose toggle to window
  useEffect(() => {
    (window as any).__toggleRightPanel = toggleVisible
    return () => { delete (window as any).__toggleRightPanel }
  }, [])

  // Hide the panel without destroying what's inside (the agent-loop calls this
  // when all agent work finishes; the browser page stays alive so the user can
  // reopen it). No-op when already hidden.
  useEffect(() => {
    (window as any).__hideRightPanel = (): void => {
      if (visibleRef.current && !closingRef.current) requestHide()
    }
    return () => { delete (window as any).__hideRightPanel }
  }, [requestHide])

  // In Electron the main process owns shortcut dispatch (before-input-event
  // forwarding covers every focused webContents), so the renderer only handles
  // keys in dev:web where there is no main process.
  const isBrowserMode = window.api?.platform === 'browser'
  useKeybinding('toggle-right-panel', isBrowserMode ? toggleVisible : NOOP)

  // The embedded browser (a separate WebContentsView) steals keyboard focus;
  // the main process forwards the toggle there through app:shortcut.
  useEffect(() => {
    return window.api?.onAppShortcut?.((name) => {
      if (name === 'toggle-right-panel') toggleVisible()
    })
  }, [toggleVisible])

  // Expose open-on-tab to window. Agent browser tools call this so their work
  // happens in front of the user instead of in an off-screen view.
  // 'terminal' is handled by BottomTerminal — keep the bridge name so older
  // callers (run-script, agent tools) don't need a separate API.
  useEffect(() => {
    (window as any).__openRightPanelTab = (id: OpenableId): void => {
      if (id === 'terminal') {
        ;(window as any).__openTerminal?.()
        return
      }
      if (closingRef.current) cancelHide()
      if (visibleRef.current && activeTabRef.current === id && openTabsRef.current.includes(id)) return
      // We are actually (re)opening the tab now. When it is the browser tab,
      // mark it agent-driven so the agent-loop can auto-hide the panel once the
      // turn finishes (chatLoop.ts). The early return above keeps a marker off
      // a panel the user already has open and active.
      if (id === 'browser') {
        ;(window as any).__agentOpenedBrowserPanel = true
      }
      // Same guard as openTool: don't collapse an already-visible panel.
      if (!visibleRef.current) {
        setOpening(true)
        setVisible(true)
      }
      setOpenTabs((prev) => {
        const next = prev.includes(id) ? prev : [...prev, id]
        return next
      })
      setActiveTab(id)
      setShowPicker(false)
    }
    return () => { delete (window as any).__openRightPanelTab }
  }, [])

  // Expose close-tab to window so the agent can close tool tabs on request.
  useEffect(() => {
    (window as any).__closeRightPanelTab = (id: OpenableId): void => {
      if (id === 'terminal') {
        ;(window as any).__closeTerminal?.()
        return
      }
      closeTabById(id)
    }
    /** Progressive Cmd+W: close picker → active tab → whole panel. Returns true if something closed. */
    ;(window as any).__popRightPanelLayer = (): boolean => {
      if (closingRef.current) return true
      if (!visibleRef.current) return false
      if (showPickerRef.current) {
        setShowPicker(false)
        return true
      }
      if (activeTabRef.current && openTabsRef.current.includes(activeTabRef.current)) {
        closeTabById(activeTabRef.current)
        return true
      }
      if (openTabsRef.current.length > 0) {
        closeTabById(openTabsRef.current[openTabsRef.current.length - 1])
        return true
      }
      requestHide()
      return true
    }
    return () => {
      delete (window as any).__closeRightPanelTab
      delete (window as any).__popRightPanelLayer
    }
  }, [requestHide])

  useEffect(() => {
    (window as any).__openFileInPanel = (path: string): void => {
      openFileInPanel(path)
    }
    return () => { delete (window as any).__openFileInPanel }
  }, [])

  const renderContent = (): React.JSX.Element => {
    if (openTabs.length === 0) {
      return (
        <div className="rp-tool-picker">
          <h3 className="rp-picker-title">{t('rightPanel.openTool')}</h3>
          {(Object.keys(TOOL_ICONS) as TabId[]).map((id) => (
            <button key={id} className="rp-tool-item" onClick={() => openTool(id)}>
              <div className="rp-tool-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={TOOL_ICONS[id]} />
                </svg>
              </div>
              <div className="rp-tool-info">
                <span className="rp-tool-label">{t(`rightPanel.tools.${id}`)}</span>
                <span className="rp-tool-desc">{t(`rightPanel.toolDescs.${id}`)}</span>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          ))}
        </div>
      )
    }

    switch (activeTab) {
      case 'files': return <FilesView projectPath={projectPath} />
      case 'git': return <GitView projectPath={projectPath} />
      case 'browser': return <BrowserView />
      case 'diff': return <DiffListView />
      case 'artifacts': return <ArtifactsView />
      case 'agents': return <SubagentsView />
      default: return <div className="rp-empty">{t('rightPanel.selectTool')}</div>
    }
  }

  return (
    <aside
      ref={panelRef}
      className={`right-panel ${closing ? 'closing' : ''}`}
      style={{
        display: visible || closing ? undefined : 'none',
        width: closing || opening ? 0 : panelWidth,
        minWidth: closing || opening ? 0 : panelWidth
      }}
    >
      <div className="rp-resizer" ref={attachResizer} />

      {/* Tab bar */}
      <div className="rp-tabs">
        {openTabs.map((id) => {
          return (
            <button
              key={id}
              className={`rp-tab ${activeTab === id ? 'active' : ''}`}
              onClick={() => switchTab(id)}
              title={t(`rightPanel.tools.${id}`)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={TOOL_ICONS[id]} />
              </svg>
              <span className="rp-tab-label">{t(`rightPanel.tools.${id}`)}</span>
              <span className="rp-tab-close-btn" onClick={(e) => closeTab(id, e)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
            </button>
          )
        })}

        {/* + button to add tools */}
        <button
          className={`rp-tab rp-tab-add ${showPicker ? 'active' : ''}`}
          onClick={() => setShowPicker(!showPicker)}
          title={t('rightPanel.addTool')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <div className="rp-tabs-spacer" />
      </div>

      {/* Tool picker dropdown */}
      {showPicker && (
        <div className="rp-picker-dropdown">
          {(Object.keys(TOOL_ICONS) as TabId[]).filter((id) => !openTabs.includes(id)).map((id) => (
            <button key={id} className="rp-picker-item" onClick={() => openTool(id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={TOOL_ICONS[id]} />
              </svg>
              <span>{t(`rightPanel.tools.${id}`)}</span>
            </button>
          ))}
          {(Object.keys(TOOL_ICONS) as TabId[]).filter((id) => !openTabs.includes(id)).length === 0 && (
            <div className="rp-picker-empty">{t('rightPanel.allToolsOpen')}</div>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="rp-content">
        {renderContent()}
      </div>
    </aside>
  )
}
