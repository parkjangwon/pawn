import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEffectiveTheme } from '../stores/theme'
import { useFocusTrap } from '../utils/focusTrap'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const theme = useEffectiveTheme()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, dialogRef, {
    initialFocus: danger ? '.confirm-btn.cancel' : '.confirm-btn.primary, .confirm-btn.danger'
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
          <div className="confirm-actions">
            <button type="button" className="confirm-btn cancel" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`confirm-btn ${danger ? 'danger' : 'primary'}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
