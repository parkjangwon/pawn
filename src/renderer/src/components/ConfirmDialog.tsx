import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEffectiveTheme } from '../stores/theme'
import { useFocusTrap } from '../utils/focusTrap'
import Button from './Button'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Optional extra content under the message (e.g. an affected-files list). */
  details?: React.ReactNode
  /** Optional middle action (e.g. "Revert the rest"). */
  secondaryLabel?: string
  onSecondary?: () => void
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  details,
  secondaryLabel,
  onSecondary,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const theme = useEffectiveTheme()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, dialogRef, {
    initialFocus: danger ? '.confirm-actions .pawn-btn-outline' : '.confirm-actions .pawn-btn-destructive, .confirm-actions .pawn-btn-default'
  })

  // Same portal trick as ProjectEditDialog: the sidebar caps child z-indexes at
  // 10, which would let chat elements paint above this dimming overlay. The
  // theme class keeps the dialog opaque outside the .app theme scope.
  return createPortal(
    <div className={`app ${theme}`}>
      <div
        className="confirm-overlay"
        onClick={onCancel}
        role="presentation"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <div
          ref={dialogRef}
          className="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-desc"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="confirm-dialog-title">{title}</h3>
          <p id="confirm-dialog-desc">{message}</p>
          {details ? <div className="confirm-details">{details}</div> : null}
          <div className="confirm-actions">
            <Button type="button" variant="outline" onClick={onCancel}>
              {cancelLabel}
            </Button>
            {secondaryLabel && onSecondary ? (
              <Button type="button" variant="secondary" onClick={onSecondary}>
                {secondaryLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={danger ? 'destructive' : 'default'}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
