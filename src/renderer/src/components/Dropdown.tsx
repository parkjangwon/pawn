import React, { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import './Dropdown.css'

export interface DropdownItem {
  id: string
  label: ReactNode
  icon?: ReactNode
  shortcut?: string
  destructive?: boolean
  disabled?: boolean
}

interface DropdownProps {
  trigger: ReactElement
  items: DropdownItem[]
  label?: ReactNode
  onSelect: (id: string) => void
  align?: 'start' | 'end'
}

export default function Dropdown({
  trigger,
  items,
  label,
  onSelect,
  align = 'start'
}: DropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setActive(-1)
    const onPointer = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open ])

  const pick = (item: DropdownItem): void => {
    if (item.disabled) return
    setOpen(false)
    onSelect(item.id)
  }

  const onMenuKey = (e: React.KeyboardEvent): void => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
    if (enabled.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const pos = enabled.indexOf(active)
      const next =
        e.key === 'ArrowDown'
          ? enabled[(pos + 1) % enabled.length]
          : enabled[(pos - 1 + enabled.length) % enabled.length]
      setActive(next as number)
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-idx="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && active >= 0 && items[active] && !items[active].disabled) {
      e.preventDefault()
      pick(items[active])
    }
  }

  const childProps = trigger.props as {
    onClick?: (e: React.MouseEvent) => void
    ref?: React.Ref<HTMLElement>
  }
  const triggerEl = React.cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      const orig = childProps.ref
      if (typeof orig === 'function') orig(node)
      else if (orig && typeof orig === 'object' && 'current' in orig)
        (orig as { current: unknown }).current = node
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: (e: React.MouseEvent) => {
      childProps.onClick?.(e)
      setOpen((v) => !v)
    }
  } as Record<string, unknown>)

  return (
    <div className="pawn-dropdown" ref={rootRef}>
      {triggerEl}
      {open ? (
        <div
          className={`pawn-dropdown-menu pawn-dropdown-${align}`}
          role="menu"
          onKeyDown={onMenuKey}
        >
          {label ? (
            <div className="pawn-dropdown-label" role="presentation">
              {label}
            </div>
          ) : null}
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              data-idx={i}
              disabled={it.disabled}
              className={`pawn-dropdown-item${it.destructive ? ' pawn-dropdown-destructive' : ''}${i === active ? ' pawn-dropdown-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(it)}
            >
              {it.icon ? <span className="pawn-dropdown-icon">{it.icon}</span> : null}
              <span className="pawn-dropdown-text">{it.label}</span>
              {it.shortcut ? <span className="pawn-dropdown-shortcut">{it.shortcut}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
