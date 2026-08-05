import { useCallback, useEffect, useRef } from 'react'

export const SIDEBAR_DEFAULT_WIDTH = 244
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480

const STORAGE_KEY = 'pawn-sidebar-width'

/** Keep the sidebar wide enough to be usable but never bigger than ~40% of the
 *  window so the chat column always keeps breathing room. */
export function clampSidebarWidth(width: number): number {
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth * 0.4))
  return Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(max, width)))
}

export function readStoredSidebarWidth(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(saved) && saved > 0 ? clampSidebarWidth(saved) : SIDEBAR_DEFAULT_WIDTH
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

export function persistSidebarWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampSidebarWidth(width)))
  } catch {
    // Best-effort; a blocked storage write must not break resizing.
  }
}

/**
 * Shared drag-to-resize behavior for the main sidebar and the Settings nav.
 * While dragging, the width is written straight to the --sidebar-width CSS
 * variable (no re-renders, no springy transitions fighting the pointer); on
 * release the committed width is handed to `onCommit`, which persists it.
 * Returns a callback ref to attach to the resizer handle element.
 */
export function useSidebarResize(onCommit: (width: number) => void): (node: HTMLDivElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const attachResizer = useCallback((node: HTMLDivElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!node) return

    const startResize = (e: PointerEvent): void => {
      e.preventDefault()
      node.setPointerCapture?.(e.pointerId)
      const startX = e.clientX
      const cssVar = Number.parseFloat(document.documentElement.style.getPropertyValue('--sidebar-width'))
      const startWidth = Number.isFinite(cssVar) && cssVar > 0 ? cssVar : SIDEBAR_DEFAULT_WIDTH
      let currentWidth = startWidth
      document.body.classList.add('resizing-sidebar')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (ev: PointerEvent): void => {
        currentWidth = clampSidebarWidth(startWidth + (ev.clientX - startX))
        document.documentElement.style.setProperty('--sidebar-width', `${currentWidth}px`)
      }

      const finish = (): void => {
        document.body.classList.remove('resizing-sidebar')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onCommitRef.current(currentWidth)
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }

    node.addEventListener('pointerdown', startResize)
    cleanupRef.current = () => node.removeEventListener('pointerdown', startResize)
  }, [])

  useEffect(() => () => {
    cleanupRef.current?.()
    document.body.classList.remove('resizing-sidebar')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  return attachResizer
}
