import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChangeLedger } from '../stores/changeLedger'
import { openFileInPanel } from '../stores/filesPanel'
import './TurnReviewBar.css'

export default function TurnReviewBar({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const { t } = useTranslation()
  const turn = useChangeLedger((s) => s.latestTurn(sessionId))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!turn || !sessionId) return null
  const applied = turn.changes.filter((c) => c.status === 'applied')
  if (applied.length === 0) return null

  const undoTurn = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const r = await useChangeLedger.getState().revertTurn(turn.id)
    setBusy(false)
    setMsg(r.ok ? t('turnReview.reverted', { count: r.reverted }) : r.error || t('turnReview.failed'))
  }

  return (
    <div className="turn-review-bar">
      <div className="turn-review-left">
        <span className="turn-review-label">{t('turnReview.label')}</span>
        <span className="turn-review-count">{t('turnReview.files', { count: applied.length })}</span>
        <div className="turn-review-files">
          {applied.slice(0, 8).map((c) => (
            <button
              key={c.path}
              type="button"
              className="turn-review-chip"
              title={c.path}
              onClick={() => openFileInPanel(c.path)}
            >
              {(c.rel || c.path).split('/').pop()}
            </button>
          ))}
          {applied.length > 8 && <span className="turn-review-more">+{applied.length - 8}</span>}
        </div>
      </div>
      <div className="turn-review-actions">
        {msg && <span className="turn-review-msg">{msg}</span>}
        <button
          type="button"
          className="turn-review-diff"
          onClick={() => {
            try {
              ;(window as unknown as { __openRightPanelTab?: (id: string) => void }).__openRightPanelTab?.('diff')
            } catch { /* ignore */ }
          }}
        >
          {t('turnReview.openDiff')}
        </button>
        <button type="button" className="turn-review-undo" disabled={busy} onClick={() => void undoTurn()}>
          {busy ? t('turnReview.undoing') : t('turnReview.undoTurn')}
        </button>
      </div>
    </div>
  )
}
