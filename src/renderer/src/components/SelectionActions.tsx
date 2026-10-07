import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx } from '../i18n'
import { Quote } from 'lucide-react'

interface SelectionActionsProps {
  /** The `.chat-messages` scroll container; only selections inside it count. */
  scrollEl: HTMLElement | null
  onQuote: (text: string) => void
  onFind?: (text: string) => void
}

interface Anchor {
  text: string
  center: number
  top: number
  bottom: number
}

const MARGIN = 12
const GAP = 8
/** Selections longer than this aren't useful as a find query. */
const FIND_MAX = 80

/** The message body a node belongs to, if it's a user/assistant message. */
function messageBodyOf(node: Node | null, root: HTMLElement): Element | null {
  const el = node instanceof Element ? node : node?.parentElement
  const body = el?.closest('.message.user .message-content, .message.assistant .message-content') ?? null
  return body && root.contains(body) ? body : null
}

/**
 * Selection must stay inside one message body; selections spanning several
 * bubbles or touching chrome (buttons, role labels) are ignored.
 */
export function readChatSelection(root: HTMLElement | null): Anchor | null {
  if (!root || typeof window.getSelection !== 'function') return null
  const sel = window.getSelection()
  if (!sel || sel.rangeCount !== 1 || sel.isCollapsed) return null
  const text = sel.toString()
  if (!text.trim()) return null
  const body = messageBodyOf(sel.anchorNode, root)
  if (!body || body !== messageBodyOf(sel.focusNode, root)) return null
  const range = sel.getRangeAt(0)
  if (typeof range.getBoundingClientRect !== 'function') return null
  const rect = range.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) return null
  return { text, center: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
}

/**
 * Floating actions over selected chat text (ZCode's selection tooltip):
 * quote into the composer, copy, or search the conversation for it.
 */
export default function SelectionActions({ scrollEl, onQuote, onFind }: SelectionActionsProps): React.JSX.Element | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const hide = useCallback(() => {
    setAnchor(null)
    setCopied(false)
  }, [])

  useEffect(() => {
    if (!scrollEl) return
    let raf: number | null = null
    const inspect = (e?: Event): void => {
      // Clicks on the menu itself must not re-read (and reset "Copied").
      if (e?.target instanceof Node && menuRef.current?.contains(e.target)) return
      if (raf !== null) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = null
        setAnchor(readChatSelection(scrollEl))
        setCopied(false)
      })
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.shiftKey || e.key === 'Shift' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a')) inspect(e)
    }
    const onSelectionChange = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) hide()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    // Document-level: a drag that starts in a message may end outside the list.
    document.addEventListener('mouseup', inspect)
    scrollEl.addEventListener('keyup', onKeyUp)
    scrollEl.addEventListener('scroll', hide, { passive: true })
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', hide)
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      document.removeEventListener('mouseup', inspect)
      scrollEl.removeEventListener('keyup', onKeyUp)
      scrollEl.removeEventListener('scroll', hide)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', hide)
    }
  }, [scrollEl, hide])

  // Center above the selection; flip below when there is no room; clamp to
  // the viewport so it never clips at window edges.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu || !anchor) return
    const rect = menu.getBoundingClientRect()
    const left = Math.max(MARGIN, Math.min(window.innerWidth - rect.width - MARGIN, anchor.center - rect.width / 2))
    const above = anchor.top - rect.height - GAP
    const top = above >= MARGIN ? above : anchor.bottom + GAP
    menu.style.left = `${left}px`
    menu.style.top = `${Math.max(MARGIN, Math.min(window.innerHeight - rect.height - MARGIN, top))}px`
  }, [anchor, copied])

  if (!anchor) return null

  const clearSelection = (): void => {
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      /* ignore */
    }
  }

  const findable = onFind && anchor.text.trim().length <= FIND_MAX && !anchor.text.includes('\n')

  return createPortal(
    <div
      ref={menuRef}
      className="selection-actions"
      role="toolbar"
      aria-label={'Selection actions'}
      style={{ left: MARGIN, top: MARGIN }}
      // Keep the selection alive while clicking the menu.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="selection-actions-btn"
        onClick={() => {
          onQuote(anchor.text)
          clearSelection()
          hide()
        }}
      >
        <Quote size={13} aria-hidden />
        {'Quote'}
      </button>
      <span className="selection-actions-sep" aria-hidden />
      <button
        type="button"
        className={`selection-actions-btn${copied ? ' copied' : ''}`}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(anchor.text)
            .then(() => setCopied(true))
            .catch(() => {})
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      {findable && (
        <>
          <span className="selection-actions-sep" aria-hidden />
          <button
            type="button"
            className="selection-actions-btn"
            onClick={() => {
              onFind?.(anchor.text.trim())
              hide()
            }}
          >
            {'Find'}
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
