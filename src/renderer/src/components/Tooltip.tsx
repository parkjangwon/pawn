import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

export interface TooltipProps {
  label: string
  shortcut?: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  children: React.ReactElement
  disabled?: boolean
}

let lastTooltipClosedTime = 0

export default function Tooltip({
  label,
  shortcut,
  placement = 'bottom',
  delay = 200,
  children,
  disabled = false
}: TooltipProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })
  const timeoutRef = useRef<number | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const gap = 6
    const margin = 8

    const vw = typeof window !== 'undefined' ? window.innerWidth : 1000
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800

    let top = 0
    let left = 0

    if (placement === 'bottom') {
      top = triggerRect.bottom + gap
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
      // Flip up if overflowing bottom
      if (top + tooltipRect.height > vh - margin && triggerRect.top - gap - tooltipRect.height >= margin) {
        top = triggerRect.top - gap - tooltipRect.height
      }
    } else if (placement === 'top') {
      top = triggerRect.top - gap - tooltipRect.height
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
      // Flip down if overflowing top
      if (top < margin && triggerRect.bottom + gap + tooltipRect.height <= vh - margin) {
        top = triggerRect.bottom + gap
      }
    } else if (placement === 'left') {
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
      left = triggerRect.left - gap - tooltipRect.width
    } else if (placement === 'right') {
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
      left = triggerRect.right + gap
    }

    // Viewport collision clamping (prevents clipping on right/left/top/bottom edges)
    left = Math.max(margin, Math.min(left, vw - margin - tooltipRect.width))
    top = Math.max(margin, Math.min(top, vh - margin - tooltipRect.height))

    setCoords({ top, left })
  }, [placement])

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition()
    }
  }, [isOpen, updatePosition])

  const show = useCallback(() => {
    if (disabled || !label) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    const timeSinceLast = Date.now() - lastTooltipClosedTime
    const actualDelay = timeSinceLast < 300 ? 0 : delay

    timeoutRef.current = window.setTimeout(() => {
      setIsOpen(true)
    }, actualDelay)
  }, [disabled, label, delay])

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (isOpen) {
      lastTooltipClosedTime = Date.now()
      setIsOpen(false)
      setCoords({ top: -9999, left: -9999 })
    }
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleScrollOrResize = (): void => {
      updatePosition()
    }
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isOpen, updatePosition])

  const childProps = children.props as React.HTMLAttributes<HTMLElement>
  const child = React.cloneElement(children as React.ReactElement<any>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      const origRef = (children as any).ref
      if (typeof origRef === 'function') origRef(node)
      else if (origRef && typeof origRef === 'object' && 'current' in origRef) origRef.current = node
    },
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(e)
      show()
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(e)
      hide()
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e)
      show()
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e)
      hide()
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      childProps.onClick?.(e)
      hide()
    }
  })

  return (
    <>
      {child}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`app-tooltip ${coords.top === -9999 ? 'measuring' : ''}`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`
            }}
            role="tooltip"
          >
            <span className="app-tooltip-label">{label}</span>
            {shortcut && <kbd className="app-tooltip-kbd">{shortcut}</kbd>}
          </div>,
          document.body
        )}
    </>
  )
}
