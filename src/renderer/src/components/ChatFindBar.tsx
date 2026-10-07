import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tx } from '../i18n'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { Message } from '../stores/app'
import { stripDisplayImages } from '../utils/attachments'
import {
  clearFindHighlights,
  collectFindRanges,
  initialFindIndex,
  normalizeFindQuery,
  paintFindHighlights,
  revealAndScrollToRange,
  stepFindIndex
} from '../utils/conversationFind'

interface ChatFindBarProps {
  /** The `.chat-messages` scroll container. */
  scrollEl: HTMLElement | null
  /** Bumped by the owner on every Cmd/Ctrl+F so a re-press refocuses the input. */
  focusNonce: number
  initialQuery?: string
  /** Full session history (only the tail window is mounted). */
  messages: Message[]
  /** Index of the first mounted message. */
  startIndex: number
  onLoadEarlier: () => void
  onClose: () => void
}

const RECOMPUTE_DEBOUNCE_MS = 120

function isMacLike(): boolean {
  const plat = window.api?.platform
  if (plat && plat !== 'browser') return plat === 'darwin'
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '')
}

/** Number of unmounted (earlier) user/assistant messages containing the query. */
export function countEarlierMatches(messages: Message[], startIndex: number, query: string): number {
  const needle = normalizeFindQuery(query)
  if (!needle || startIndex <= 0) return 0
  let n = 0
  for (let i = 0; i < Math.min(startIndex, messages.length); i++) {
    const m = messages[i]
    if (m.role === 'system') continue
    if (stripDisplayImages(m.content || '').toLocaleLowerCase().includes(needle)) n++
  }
  return n
}

export default function ChatFindBar({
  scrollEl,
  focusNonce,
  initialQuery = '',
  messages,
  startIndex,
  onLoadEarlier,
  onClose
}: ChatFindBarProps): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [ranges, setRanges] = useState<Range[]>([])
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const rangesRef = useRef<Range[]>([])
  const activeRef = useRef(-1)
  const queryRef = useRef(query)
  queryRef.current = query

  // Focus (and select) on open and on every repeated Cmd/Ctrl+F.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [focusNonce])

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery)
  }, [initialQuery, focusNonce])

  const apply = useCallback((next: Range[], index: number, scroll: boolean) => {
    rangesRef.current = next
    activeRef.current = index
    setRanges(next)
    setActive(index)
    paintFindHighlights(next, index)
    if (scroll && index >= 0 && next[index]) revealAndScrollToRange(next[index])
  }, [])

  // Query changed → fresh search, jump to the first match in view.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = collectFindRanges(scrollEl, query)
      const top = scrollEl?.getBoundingClientRect?.().top ?? 0
      const index = initialFindIndex(next, top)
      apply(next, index, true)
    }, query ? RECOMPUTE_DEBOUNCE_MS : 0)
    return () => window.clearTimeout(id)
  }, [query, scrollEl, apply])

  // DOM changed (streaming, load earlier, folded blocks) → re-collect but keep
  // the current position and never scroll on the user's behalf.
  useEffect(() => {
    if (!scrollEl || typeof MutationObserver === 'undefined') return
    let timer: number | null = null
    const observer = new MutationObserver(() => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        if (!normalizeFindQuery(queryRef.current)) return
        const next = collectFindRanges(scrollEl, queryRef.current)
        const index = next.length === 0 ? -1 : Math.min(Math.max(activeRef.current, 0), next.length - 1)
        apply(next, index, false)
      }, RECOMPUTE_DEBOUNCE_MS)
    })
    observer.observe(scrollEl, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [scrollEl, apply])

  useEffect(() => () => clearFindHighlights(), [])

  const step = useCallback((direction: 'next' | 'prev') => {
    const list = rangesRef.current
    if (list.length === 0) return
    apply(list, stepFindIndex(activeRef.current, list.length, direction), true)
  }, [apply])

  // Cmd/Ctrl+G, Shift+Cmd/Ctrl+G — like every native find bar.
  useEffect(() => {
    const mac = isMacLike()
    const onKey = (e: KeyboardEvent): void => {
      const mod = mac ? e.metaKey : e.ctrlKey
      if (!mod || e.altKey || (e.key.toLowerCase() !== 'g' && e.code !== 'KeyG')) return
      e.preventDefault()
      step(e.shiftKey ? 'prev' : 'next')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      step(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? 'prev' : 'next')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  const total = ranges.length
  const hasQuery = normalizeFindQuery(query).length > 0
  const earlier = hasQuery ? countEarlierMatches(messages, startIndex, query) : 0
  const counter = !hasQuery
    ? ''
    : total > 0
      ? `${active + 1}/${total}`
      : 'No results'

  return (
    <div className="chat-find" role="search" data-find-ignore="true">
      <div className="chat-find-row">
        <Search size={14} className="chat-find-icon" aria-hidden />
        <input
          ref={inputRef}
          className="chat-find-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={'Find in conversation'}
          aria-label={'Find in conversation'}
          spellCheck={false}
          autoComplete="off"
        />
        <span
          className={`chat-find-count${hasQuery && total === 0 ? ' empty' : ''}`}
          aria-live="polite"
        >
          {counter}
        </span>
        <button
          type="button"
          className="chat-find-btn"
          onClick={() => step('prev')}
          disabled={total === 0}
          aria-label={'Previous match (Shift+Enter)'}
          title={'Previous match (Shift+Enter)'}
        >
          <ChevronUp size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="chat-find-btn"
          onClick={() => step('next')}
          disabled={total === 0}
          aria-label={'Next match (Enter)'}
          title={'Next match (Enter)'}
        >
          <ChevronDown size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="chat-find-btn"
          onClick={onClose}
          aria-label={'Close (Esc)'}
          title={'Close (Esc)'}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      {earlier > 0 && (
        <div className="chat-find-earlier">
          <span>{`${earlier} earlier messages also match`}</span>
          <button type="button" className="chat-find-earlier-btn" onClick={onLoadEarlier}>
            {'Load them'}
          </button>
        </div>
      )}
    </div>
  )
}
