import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import { useKeybinding } from '../stores/keybindings'
import TerminalView from './TerminalView'
import './BottomTerminal.css'

const NOOP = (): void => {}
const HIDE_MS = 220
const MIN_HEIGHT = 120
const MAX_HEIGHT_RATIO = 0.7
const STORAGE_KEY = 'pawn-terminal-height'

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= MIN_HEIGHT) return n
    }
  } catch { /* ignore */ }
  return Math.min(Math.round(window.innerHeight * 0.35), 360)
}

function persistHeight(h: number): void {
  try { localStorage.setItem(STORAGE_KEY, String(h)) } catch { /* ignore */ }
}

/**
 * Codex-style bottom terminal: full content width under chat + right panel.
 * Wider horizontal space makes shell work far more usable than a side strip.
 */
export default function BottomTerminal(): React.JSX.Element {
  const { t } = useTranslation()
  const [panelHeight, setPanelHeight] = useState(readStoredHeight)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [opening, setOpening] = useState(false)
  // Keep the xterm/PTY tree mounted after the first open so hide/show doesn't
  // kill the shell session (same pattern as the old right-panel terminal tab).
  const [everOpened, setEverOpened] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)
  const hideTimer = useRef<number | null>(null)
  const visibleRef = useRef(visible)
  const closingRef = useRef(closing)
  useEffect(() => { visibleRef.current = visible }, [visible])
  useEffect(() => { closingRef.current = closing }, [closing])
  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    document.body.classList.remove('resizing-bottom-terminal')
  }, [])

  const activeProject = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const projectPath = getEffectiveProjectPath(activeProject, activeSessionId)

  useLayoutEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      if (!panelRef.current || isResizing.current || closingRef.current) return
      panelRef.current.style.height = panelHeight + 'px'
      setOpening(false)
    })
  }, [panelHeight, visible])

  const cancelHide = useCallback((): void => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setClosing(false)
  }, [])

  const requestHide = useCallback((): void => {
    if (closingRef.current) return
    setClosing(true)
    hideTimer.current = window.setTimeout(() => {
      setVisible(false)
      setClosing(false)
      hideTimer.current = null
    }, HIDE_MS)
  }, [])

  const open = useCallback((): void => {
    if (closingRef.current) cancelHide()
    if (visibleRef.current) return
    setEverOpened(true)
    setOpening(true)
    setVisible(true)
  }, [cancelHide])

  const toggleVisible = useCallback((): void => {
    if (closingRef.current) {
      cancelHide()
      return
    }
    if (visibleRef.current) {
      requestHide()
    } else {
      open()
    }
  }, [cancelHide, requestHide, open])

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
      panelRef.current.style.transition = 'none'
      document.body.classList.add('resizing-bottom-terminal')
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (ev: PointerEvent): void => {
        if (!isResizing.current || !panelRef.current) return
        const maxH = Math.round(window.innerHeight * MAX_HEIGHT_RATIO)
        const newHeight = Math.max(MIN_HEIGHT, Math.min(maxH, window.innerHeight - ev.clientY))
        panelRef.current.style.height = newHeight + 'px'
      }

      const finish = (): void => {
        isResizing.current = false
        if (panelRef.current) panelRef.current.style.transition = ''
        document.body.classList.remove('resizing-bottom-terminal')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (panelRef.current) {
          const finalHeight = panelRef.current.offsetHeight
          setPanelHeight(finalHeight)
          persistHeight(finalHeight)
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

  useEffect(() => {
    ;(window as any).__toggleTerminal = toggleVisible
    ;(window as any).__openTerminal = open
    ;(window as any).__closeTerminal = requestHide
    /** Progressive Cmd+W: hide terminal only if open. */
    ;(window as any).__closeTerminalIfOpen = (): boolean => {
      if (closingRef.current) return true
      if (!visibleRef.current) return false
      requestHide()
      return true
    }
    return () => {
      delete (window as any).__toggleTerminal
      delete (window as any).__openTerminal
      delete (window as any).__closeTerminal
      delete (window as any).__closeTerminalIfOpen
    }
  }, [toggleVisible, open, requestHide])

  const isBrowserMode = window.api?.platform === 'browser'
  useKeybinding('toggle-terminal', isBrowserMode ? toggleVisible : NOOP)

  useEffect(() => {
    return window.api?.onAppShortcut?.((name) => {
      if (name === 'toggle-terminal') toggleVisible()
    })
  }, [toggleVisible])

  const show = visible || closing
  const heightStyle = closing || opening ? 0 : panelHeight

  return (
    <div
      ref={panelRef}
      className={`bottom-terminal ${closing ? 'closing' : ''} ${visible ? 'open' : ''}`}
      style={{
        display: show || everOpened ? undefined : 'none',
        height: show ? heightStyle : 0,
        // Keep mounted after first open; collapse to 0 when fully hidden so the
        // chat reclaims the space while the PTY stays alive.
        minHeight: show ? (closing || opening ? 0 : undefined) : 0,
        overflow: show ? undefined : 'hidden',
        pointerEvents: show ? undefined : 'none',
        opacity: show ? undefined : 0
      }}
      aria-hidden={!visible && !closing}
    >
      <div className="bt-resizer" ref={attachResizer} />

      <div className="bt-header">
        <div className="bt-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 17l6-6-6-6m8 14h8" />
          </svg>
          <span>{t('rightPanel.tools.terminal')}</span>
          {projectPath && (
            <span className="bt-path" title={projectPath}>{projectPath}</span>
          )}
        </div>
        <button
          type="button"
          className="bt-close"
          onClick={requestHide}
          title={t('bottomTerminal.close')}
          aria-label={t('bottomTerminal.close')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="bt-content">
        {everOpened && <TerminalView projectPath={projectPath} />}
      </div>
    </div>
  )
}
