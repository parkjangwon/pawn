import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { useAppStore } from '../stores/app'
import TerminalView from './TerminalView'
import FilesView from './FilesView'
import GitView from './GitView'
import BrowserView from './BrowserView'
import DiffListView from './DiffListView'
import './RightPanel.css'

type TabId = 'terminal' | 'files' | 'git' | 'browser' | 'diff'

interface ToolDef {
  id: TabId
  icon: string
  label: string
  desc: string
}

const TOOLS: ToolDef[] = [
  { id: 'terminal', icon: 'M4 17l6-6-6-6m8 14h8', label: 'Terminal', desc: 'Local shell access' },
  { id: 'files', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', label: 'Files', desc: 'Browse project files' },
  { id: 'git', icon: 'M22 12h-4l-3 9L9 3l-3 9H2', label: 'Git', desc: 'Version control' },
  { id: 'browser', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9', label: 'Browser', desc: 'Web browser' },
  { id: 'diff', icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6', label: 'Diff', desc: 'Recent file changes' }
]

const WIDTH_KEY = 'pawn-right-panel-width'

function loadWidth(): number {
  try { return parseInt(localStorage.getItem(WIDTH_KEY) || '320', 10) } catch { return 320 }
}

export default function RightPanel(): React.JSX.Element | null {
  const [openTabs, setOpenTabs] = useState<TabId[]>(() => {
    try { return JSON.parse(localStorage.getItem('pawn-right-panel-tabs') || '[]') } catch { return [] }
  })
  const [activeTab, setActiveTab] = useState<TabId | null>(() => {
    try { return (localStorage.getItem('pawn-right-panel-tab') as TabId) || null } catch { return null }
  })
  const [showPicker, setShowPicker] = useState(false)
  const [panelWidth, setPanelWidth] = useState(loadWidth)
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem('pawn-right-panel-visible') === 'true' } catch { return false }
  })
  const panelRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)

  const { projects, activeProjectId } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectPath = activeProject?.paths?.[0] || ''

 // Apply panelWidth from state to DOM
  useLayoutEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      if (panelRef.current && !isResizing.current) {
        panelRef.current.style.width = panelWidth + 'px'
        panelRef.current.style.minWidth = panelWidth + 'px'
      }
    })
  }, [panelWidth, visible])

  // Save visibility
  const toggleVisible = (): void => {
    setVisible((v) => {
      const next = !v
      try { localStorage.setItem('pawn-right-panel-visible', String(next)) } catch {}
      return next
    })
  }

  // Open a tool as a tab (or switch to it if already open)
  const openTool = (id: TabId): void => {
    setOpenTabs((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id]
      localStorage.setItem('pawn-right-panel-tabs', JSON.stringify(next))
      return next
    })
    setActiveTab(id)
    localStorage.setItem('pawn-right-panel-tab', id)
    setShowPicker(false)
  }

  // Switch to a tab
  const switchTab = (id: TabId): void => {
    setActiveTab(id)
    localStorage.setItem('pawn-right-panel-tab', id)
  }

  // Close a tab
  const closeTab = (id: TabId, e: React.MouseEvent): void => {
    e.stopPropagation()
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id)
      localStorage.setItem('pawn-right-panel-tabs', JSON.stringify(next))
      if (activeTab === id) {
        const newActive = next.length > 0 ? next[next.length - 1] : null
        setActiveTab(newActive)
        if (newActive) localStorage.setItem('pawn-right-panel-tab', newActive)
        else setVisible(false)
      }
      return next
    })
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
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (panelRef.current) {
          const finalWidth = panelRef.current.offsetWidth
          setPanelWidth(finalWidth)
          try { localStorage.setItem(WIDTH_KEY, String(finalWidth)) } catch {}
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
  }, [])

  // Cmd+B toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        toggleVisible()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Expose toggle to window
  useEffect(() => {
    (window as any).__toggleRightPanel = toggleVisible
    return () => { delete (window as any).__toggleRightPanel }
  }, [])

  if (!visible) return null

  const renderContent = (): React.JSX.Element => {
    if (openTabs.length === 0) {
      return (
        <div className="rp-tool-picker">
          <h3 className="rp-picker-title">Open a tool</h3>
          {TOOLS.map((tool) => (
            <button key={tool.id} className="rp-tool-item" onClick={() => openTool(tool.id)}>
              <div className="rp-tool-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={tool.icon} />
                </svg>
              </div>
              <div className="rp-tool-info">
                <span className="rp-tool-label">{tool.label}</span>
                <span className="rp-tool-desc">{tool.desc}</span>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          ))}
        </div>
      )
    }

    const tool = TOOLS.find((t) => t.id === activeTab)
    switch (activeTab) {
      case 'terminal': return <TerminalView projectPath={projectPath} />
      case 'files': return <FilesView projectPath={projectPath} />
      case 'git': return <GitView projectPath={projectPath} />
      case 'browser': return <BrowserView />
      case 'diff': return <DiffListView />
      default: return <div className="rp-empty">Select a tool</div>
    }
  }

  return (
    <aside ref={panelRef} className="right-panel">
      <div className="rp-resizer" ref={attachResizer} />

      {/* Tab bar */}
      <div className="rp-tabs">
        {openTabs.map((id) => {
          const tool = TOOLS.find((t) => t.id === id)
          if (!tool) return null
          return (
            <button
              key={id}
              className={`rp-tab ${activeTab === id ? 'active' : ''}`}
              onClick={() => switchTab(id)}
              title={tool.label}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={tool.icon} />
              </svg>
              {activeTab === id && <span className="rp-tab-label">{tool.label}</span>}
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
          title="Add tool"
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
          {TOOLS.filter((t) => !openTabs.includes(t.id)).map((tool) => (
            <button key={tool.id} className="rp-picker-item" onClick={() => openTool(tool.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={tool.icon} />
              </svg>
              <span>{tool.label}</span>
            </button>
          ))}
          {TOOLS.filter((t) => !openTabs.includes(t.id)).length === 0 && (
            <div className="rp-picker-empty">All tools are open</div>
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
