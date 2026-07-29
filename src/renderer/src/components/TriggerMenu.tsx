import { useEffect, useRef } from 'react'
import './TriggerMenu.css'

export interface TriggerItem {
  id: string
  label: string
  description?: string
  hint?: string
  icon?: React.ReactNode
  action?: () => void
  insert?: string
}

interface TriggerMenuProps {
  open: boolean
  trigger: '/' | '@' | null
  items: TriggerItem[]
  selectedIndex: number
  loading?: boolean
  emptyText?: string
  title?: string
  onSelect: (item: TriggerItem) => void
  onHover: (index: number) => void
}

export default function TriggerMenu({ open, trigger, items, selectedIndex, loading, emptyText, title, onSelect, onHover }: TriggerMenuProps): React.JSX.Element | null {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  return (
    <div className="trigger-menu" role="listbox">
      <div className="trigger-menu-head">
        <span className="trigger-menu-tag">{trigger}</span>
        <span className="trigger-menu-title">{title}</span>
      </div>
      <div className="trigger-menu-list" ref={listRef}>
        {loading && <div className="trigger-menu-empty">{emptyText}</div>}
        {!loading && items.length === 0 && <div className="trigger-menu-empty">{emptyText}</div>}
        {!loading && items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            data-idx={i}
            role="option"
            aria-selected={i === selectedIndex}
            className={`trigger-item ${i === selectedIndex ? 'selected' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => { e.preventDefault(); onSelect(it) }}
          >
            {it.icon && <span className="trigger-item-icon">{it.icon}</span>}
            <span className="trigger-item-body">
              <span className="trigger-item-label">{it.label}</span>
              {it.description && <span className="trigger-item-desc">{it.description}</span>}
            </span>
            {it.hint && <span className="trigger-item-hint">{it.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
