import { createPortal } from 'react-dom'
import { useEffectiveTheme } from '../stores/theme'
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

export default function ConfirmDialog({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel", danger = true, onConfirm, onCancel }: ConfirmDialogProps): React.JSX.Element {
  const theme = useEffectiveTheme()
  // Same portal trick as ProjectEditDialog: the sidebar caps child z-indexes at
  // 10, which would let chat elements paint above this dimming overlay. The
  // theme class keeps the dialog opaque outside the .app theme scope.
  return createPortal(
    <div className={`app ${theme}`}>
      <div className="confirm-overlay" onClick={onCancel}>
        <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
          <h3>{title}</h3>
          <p>{message}</p>
          <div className="confirm-actions">
            <button className="confirm-btn cancel" onClick={onCancel}>{cancelLabel}</button>
            <button className={`confirm-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
