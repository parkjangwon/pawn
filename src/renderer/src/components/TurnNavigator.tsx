import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../stores/app'
import { buildTurnItems, turnBarVisual } from '../utils/turnNavigator'

interface TurnNavigatorProps {
  messages: Message[]
  /** The `.chat-messages` scroll container. */
  scrollEl: HTMLElement | null
  /** True while the agent is working on the latest turn. */
  busy?: boolean
  onJump: (messageId: string) => void
}

/** A turn counts as "current" once its prompt passes this share of the viewport. */
const ACTIVE_LINE = 0.35

/**
 * Left-edge minimap of user prompts (ZCode-style turn navigator). Each bar is
 * one prompt; hovering magnifies nearby bars and previews the prompt + reply,
 * clicking scrolls the conversation to that prompt.
 */
function TurnNavigatorImpl({ messages, scrollEl, busy, onJump }: TurnNavigatorProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const items = useMemo(() => buildTurnItems(messages), [messages])
  const [activeIndex, setActiveIndex] = useState(items.length - 1)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverTop, setHoverTop] = useState(0)
  const navRef = useRef<HTMLElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const barRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  // Which prompt is "current" for the reader: the last one whose top edge has
  // scrolled above the active line. Unmounted (earlier) prompts are skipped.
  const recompute = useCallback(() => {
    if (!scrollEl || items.length === 0) return
    const box = scrollEl.getBoundingClientRect()
    const line = box.top + box.height * ACTIVE_LINE
    const mounted = new Map<string, Element>()
    for (const el of Array.from(scrollEl.querySelectorAll('.message.user[data-message-id]'))) {
      mounted.set(el.getAttribute('data-message-id') || '', el)
    }
    let next = -1
    let firstMounted = -1
    for (let i = 0; i < items.length; i++) {
      const el = mounted.get(items[i].id)
      if (!el) continue
      if (firstMounted === -1) firstMounted = i
      if (el.getBoundingClientRect().top <= line) next = i
      else break
    }
    if (next === -1) next = firstMounted > 0 ? firstMounted - 1 : 0
    setActiveIndex(next)
  }, [scrollEl, items])

  useEffect(() => {
    if (!scrollEl) return
    let raf: number | null = null
    const onScroll = (): void => {
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        recompute()
      })
    }
    recompute()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [scrollEl, recompute])

  // Keep the active bar visible inside the rail without scrolling any ancestor.
  useEffect(() => {
    const rail = railRef.current
    const bar = barRefs.current.get(activeIndex)
    if (!rail || !bar) return
    const top = bar.offsetTop
    const bottom = top + bar.offsetHeight
    if (top < rail.scrollTop) rail.scrollTop = top - 8
    else if (bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = bottom - rail.clientHeight + 8
  }, [activeIndex])

  const showPreview = (index: number): void => {
    setHoverIndex(index)
    const bar = barRefs.current.get(index)
    const nav = navRef.current
    if (!bar || !nav) return
    const b = bar.getBoundingClientRect()
    const n = nav.getBoundingClientRect()
    // Keep the (vertically centered) card inside the pane.
    const half = 64
    const center = b.top + b.height / 2 - n.top
    setHoverTop(n.height > half * 2 ? Math.max(half, Math.min(n.height - half, center)) : center)
  }

  if (items.length < 2) return null
  const hovered = hoverIndex !== null ? items[hoverIndex] : null
  const lastIndex = items.length - 1

  return (
    <nav ref={navRef} className="turn-nav" aria-label={t('chat.turnNav.label')} data-find-ignore="true">
      <div
        ref={railRef}
        className="turn-nav-rail"
        onPointerLeave={() => setHoverIndex(null)}
        onScroll={() => setHoverIndex(null)}
      >
        {items.map((item, i) => {
          const visual = turnBarVisual(i, hoverIndex)
          const active = i === activeIndex
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) barRefs.current.set(i, el)
                else barRefs.current.delete(i)
              }}
              type="button"
              className={`turn-nav-item${active ? ' active' : ''}${busy && i === lastIndex ? ' running' : ''}`}
              aria-current={active ? 'location' : undefined}
              aria-label={t('chat.turnNav.jumpTo', { index: i + 1, total: items.length })}
              onPointerEnter={() => showPreview(i)}
              onFocus={() => showPreview(i)}
              onBlur={() => setHoverIndex(null)}
              onClick={() => onJump(item.id)}
            >
              <span
                className="turn-nav-bar"
                style={{
                  transform: `scaleX(${visual.scale})`,
                  opacity: active && hoverIndex === null ? 1 : visual.opacity
                }}
              />
            </button>
          )
        })}
      </div>
      {hovered && (
        <div className="turn-nav-preview" style={{ top: hoverTop }} role="tooltip">
          <div className="turn-nav-preview-index">
            {t('chat.turnNav.position', { index: (hoverIndex ?? 0) + 1, total: items.length })}
          </div>
          <p className="turn-nav-preview-user">{hovered.userPreview || t('chat.turnNav.attachmentOnly')}</p>
          <p className={`turn-nav-preview-reply${hovered.replyPreview ? '' : ' muted'}`}>
            {hovered.replyPreview ??
              (busy && hoverIndex === lastIndex ? t('chat.turnNav.working') : t('chat.turnNav.noReply'))}
          </p>
        </div>
      )}
    </nav>
  )
}

const TurnNavigator = memo(TurnNavigatorImpl)
export default TurnNavigator
