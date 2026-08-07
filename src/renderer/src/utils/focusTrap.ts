/**
 * Lightweight focus management for modals and overlays.
 * - Traps Tab / Shift+Tab inside a container
 * - Restores focus to the previously focused element on unmount
 * - Optionally focuses the first focusable (or a preferred selector)
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** True when the element can receive keyboard focus (works for position:fixed too). */
export function isFocusableVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false
  if (el.tabIndex < 0) return false
  if (el.hidden || el.hasAttribute('hidden')) return false
  if (el.closest('[hidden], [aria-hidden="true"]')) return false
  // Modern browsers: respects display/visibility/content-visibility.
  const anyEl = el as HTMLElement & {
    checkVisibility?: (opts?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean
  }
  if (typeof anyEl.checkVisibility === 'function') {
    try {
      return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    } catch {
      /* fall through */
    }
  }
  try {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false
    }
    if (style.opacity === '0') return false
  } catch {
    /* jsdom without layout */
  }
  // getClientRects works for fixed/sticky; offsetParent does not (fixed → null).
  if (typeof el.getClientRects === 'function' && el.getClientRects().length > 0) {
    return true
  }
  // jsdom / pre-layout: empty rects but still in the tree with an offset parent.
  if (el.offsetParent !== null) return true
  // Last resort for fixed elements before first layout paint (rAF will retry focus).
  return el.isConnected && (el.style?.position === 'fixed' || getComputedStyleSafe(el)?.position === 'fixed')
}

function getComputedStyleSafe(el: HTMLElement): CSSStyleDeclaration | null {
  try {
    return window.getComputedStyle(el)
  } catch {
    return null
  }
}

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isFocusableVisible)
}

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  opts?: {
    /** CSS selector for preferred initial focus (e.g. ".allow-btn") */
    initialFocus?: string
    /** When false, do not auto-focus on activate (default true) */
    autoFocus?: boolean
  }
): void {
  const previousRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    const root = containerRef.current
    if (!root) return

    previousRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const autoFocus = opts?.autoFocus !== false
    if (autoFocus) {
      const preferred = opts?.initialFocus
        ? root.querySelector<HTMLElement>(opts.initialFocus)
        : null
      const list = getFocusable(root)
      const target = preferred && list.includes(preferred) ? preferred : list[0]
      // rAF so portal/DOM is painted
      requestAnimationFrame(() => target?.focus())
    }

    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const list = getFocusable(root)
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const activeEl = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (!activeEl || activeEl === first || !root.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else if (!activeEl || activeEl === last || !root.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const prev = previousRef.current
      if (prev && document.contains(prev)) {
        requestAnimationFrame(() => prev.focus())
      }
    }
  }, [active, containerRef, opts?.initialFocus, opts?.autoFocus])
}

/**
 * Enter/Space activate for role="button" rows that are not real <button>s.
 * Ignores keys that originated on nested interactive children (pin/delete).
 */
export function activateOnKey(e: ReactKeyboardEvent, action: () => void): void {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const target = e.target
  if (target instanceof Element && target !== e.currentTarget) {
    // Nested button/link owns this keypress — do not also select the row.
    if (target.closest('button, a[href], input, select, textarea, [role="menuitem"]')) {
      return
    }
  }
  e.preventDefault()
  e.stopPropagation()
  action()
}
