/**
 * In-conversation find (Cmd/Ctrl+F) over the rendered chat DOM.
 *
 * Highlights use the CSS Custom Highlight API (`CSS.highlights` +
 * `::highlight()`), so streamed markdown is never mutated or re-laid out by
 * wrapping matches in <mark>. When the API is unavailable (older engines,
 * jsdom) matches are still counted and scrolled to — just not painted.
 */

export const FIND_HIGHLIGHT = 'pawn-chat-find'
export const FIND_HIGHLIGHT_ACTIVE = 'pawn-chat-find-active'

/** Searchable regions: rendered user/assistant message bodies only. */
export const FIND_SCOPE_SELECTOR =
  '.message.user .message-content, .message.assistant .message-content'

/** Chrome inside a message body that should never produce matches. */
const SKIP_SELECTOR =
  'button, input, textarea, select, [contenteditable="true"], [data-find-ignore="true"], .cursor-blink'

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}
type HighlightCtor = new (...ranges: Range[]) => { priority?: number }

function highlightSupport(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return null
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights
  const Highlight = (window as unknown as { Highlight?: HighlightCtor }).Highlight
  if (!registry || !Highlight) return null
  return { registry, Highlight }
}

export function isHighlightApiSupported(): boolean {
  return highlightSupport() !== null
}

export function normalizeFindQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

function collectInElement(el: Element, needle: string, out: Range[]): void {
  const doc = el.ownerDocument
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT
      return (node as Text).data.toLocaleLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP
    }
  })
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    const hay = text.data.toLocaleLowerCase()
    // toLocaleLowerCase can change length for a few scripts; indexes are only
    // safe to map back when it doesn't.
    if (hay.length === text.data.length) {
      let from = 0
      while (from <= hay.length - needle.length) {
        const idx = hay.indexOf(needle, from)
        if (idx === -1) break
        const range = doc.createRange()
        range.setStart(text, idx)
        range.setEnd(text, idx + needle.length)
        out.push(range)
        from = idx + needle.length
      }
    }
    node = walker.nextNode()
  }
}

/** All match ranges under `root`, in document order. */
export function collectFindRanges(root: Element | null, query: string): Range[] {
  const needle = normalizeFindQuery(query)
  if (!root || !needle) return []
  const ranges: Range[] = []
  for (const scope of Array.from(root.querySelectorAll(FIND_SCOPE_SELECTOR))) {
    collectInElement(scope, needle, ranges)
  }
  return ranges
}

/** Wrap-around step through `total` matches. */
export function stepFindIndex(current: number, total: number, direction: 'next' | 'prev'): number {
  if (total <= 0) return -1
  if (current < 0 || current >= total) return direction === 'next' ? 0 : total - 1
  return (current + (direction === 'next' ? 1 : -1) + total) % total
}

/**
 * First match at or below the top of the viewport, so opening find doesn't
 * yank the view when a match is already on screen. Falls back to the last
 * match (chats are read bottom-up).
 */
export function initialFindIndex(ranges: Range[], viewportTop: number): number {
  if (ranges.length === 0) return -1
  for (let i = 0; i < ranges.length; i++) {
    const rect = rangeRect(ranges[i])
    if (rect && rect.bottom >= viewportTop) return i
  }
  return ranges.length - 1
}

function rangeRect(range: Range): DOMRect | null {
  try {
    if (typeof range.getBoundingClientRect !== 'function') return null
    return range.getBoundingClientRect()
  } catch {
    return null
  }
}

export function paintFindHighlights(ranges: Range[], activeIndex: number): void {
  const support = highlightSupport()
  if (!support) return
  const { registry, Highlight } = support
  const all = new Highlight(...ranges)
  all.priority = 0
  const active = activeIndex >= 0 && ranges[activeIndex] ? new Highlight(ranges[activeIndex]) : new Highlight()
  active.priority = 1
  registry.set(FIND_HIGHLIGHT, all)
  registry.set(FIND_HIGHLIGHT_ACTIVE, active)
}

export function clearFindHighlights(): void {
  const support = highlightSupport()
  support?.registry.delete(FIND_HIGHLIGHT)
  support?.registry.delete(FIND_HIGHLIGHT_ACTIVE)
}

/** Event a collapsed container (e.g. a folded code block) listens to so the
 *  active match inside it becomes visible. */
export const REVEAL_EVENT = 'pawn:reveal'

export function revealAndScrollToRange(range: Range, behavior: ScrollBehavior = 'smooth'): void {
  const node = range.startContainer
  const el = node instanceof Element ? node : node.parentElement
  if (!el) return
  const folded = el.closest('[data-folded="true"]')
  if (folded) folded.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: false }))
  const scroll = (): void => {
    const rect = rangeRect(range)
    const scroller = el.closest('.chat-messages') as HTMLElement | null
    if (rect && scroller && typeof scroller.scrollBy === 'function' && rect.height > 0) {
      const box = scroller.getBoundingClientRect()
      const delta = rect.top - box.top - box.height / 2 + rect.height / 2
      scroller.scrollBy({ top: delta, behavior })
      return
    }
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior })
  }
  // A just-unfolded block needs a frame to lay out before measuring.
  if (folded && typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll)
  else scroll()
}
