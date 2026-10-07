import { useEffect, useRef, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { useEffectiveTheme } from '../stores/theme'
import { useFocusTrap } from '../utils/focusTrap'
import Button from './Button'
import './Dialog.css'

export interface DialogProps {
  open: boolean
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  /** Accessible label for the corner close button — pass t('common.close'). No hardcoded strings. */
  closeLabel: string
  showCloseButton?: boolean
  onClose: () => void
}

export default function Dialog({
  open,
  title,
  description,
  children,
  footer,
  closeLabel,
  showCloseButton = true,
  onClose
}: DialogProps): React.JSX.Element | null {
  const theme = useEffectiveTheme()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(open, dialogRef)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={`app ${theme}`}>
      <div className="pawn-dialog-overlay" onClick={onClose} role="presentation">
        <div
          ref={dialogRef}
          className="pawn-dialog"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pawn-dialog-header">
            <div className="pawn-dialog-title">{title}</div>
            {description ? <div className="pawn-dialog-desc">{description}</div> : null}
          </div>
          {children}
          {footer ? <div className="pawn-dialog-footer">{footer}</div> : null}
          {showCloseButton ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="pawn-dialog-close"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M1 1l10 10M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </Button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}

type DivProps = HTMLAttributes<HTMLDivElement>

export function DialogHeader({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-dialog-header${className ? ` ${className}` : ''}`} {...rest} />
}

export function DialogTitle({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-dialog-title${className ? ` ${className}` : ''}`} {...rest} />
}

export function DialogDescription({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-dialog-desc${className ? ` ${className}` : ''}`} {...rest} />
}

export function DialogFooter({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-dialog-footer${className ? ` ${className}` : ''}`} {...rest} />
}
