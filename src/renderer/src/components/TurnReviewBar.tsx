import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChangeLedger, type RevertConflict } from '../stores/changeLedger'
import { openFileInPanel } from '../stores/filesPanel'
import ConfirmDialog from './ConfirmDialog'
import './TurnReviewBar.css'

function relativeTime(ts: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 45) return t('turnReview.justNow')
  if (sec < 3600) return t('turnReview.minutesAgo', { count: Math.floor(sec / 60) })
  if (sec < 86400) return t('turnReview.hoursAgo', { count: Math.floor(sec / 3600) })
  return t('turnReview.daysAgo', { count: Math.floor(sec / 86400) })
}

function computeChangeStats(c: { before?: string | null; after?: string; op: string }): { label: string; kind: 'add' | 'del' | 'mod' } | null {
  if (c.op === 'delete') {
    const lines = c.before ? c.before.split('\n').length : 0
    return { label: `-${lines}`, kind: 'del' }
  }
  if (c.op === 'write' && c.before == null) {
    const lines = c.after ? c.after.split('\n').length : 0
    return { label: `+${lines}`, kind: 'add' }
  }
  if (c.before != null && c.after != null) {
    const oldLines = c.before.split('\n').length
    const newLines = c.after.split('\n').length
    const diff = newLines - oldLines
    if (diff > 0) return { label: `+${diff}`, kind: 'add' }
    if (diff < 0) return { label: `-${Math.abs(diff)}`, kind: 'del' }
    return { label: `~`, kind: 'mod' }
  }
  return null
}

export default function TurnReviewBar({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const { t } = useTranslation()
  const turns = useChangeLedger((s) => s.turns)
  const turn = useChangeLedger((s) => s.latestTurn(sessionId))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  /** Revert blocked because files changed after the agent touched them. */
  const [pending, setPending] = useState<{ turnId: string; conflicts: RevertConflict[] } | null>(null)

  const sessionTurns = useMemo(
    () =>
      sessionId
        ? [...turns].filter((x) => x.sessionId === sessionId && x.changes.some((c) => c.status === 'applied')).reverse()
        : [],
    [turns, sessionId]
  )

  if (!turn || !sessionId) return null
  const applied = turn.changes.filter((c) => c.status === 'applied')
  if (applied.length === 0) return null

  const undoTurn = async (turnId?: string, mode?: 'force' | 'skip'): Promise<void> => {
    const id = turnId || turn.id
    setBusy(true)
    setMsg(null)
    setPending(null)
    const r = await useChangeLedger.getState().revertTurn(id, {
      force: mode === 'force',
      skipConflicts: mode === 'skip'
    })
    setBusy(false)
    if (!r.ok && r.error === 'conflicts' && r.conflicts?.length) {
      setPending({ turnId: id, conflicts: r.conflicts })
      return
    }
    if (r.ok) {
      setMsg(
        r.skipped
          ? t('turnReview.revertedSkipped', { count: r.reverted, skipped: r.skipped })
          : t('turnReview.reverted', { count: r.reverted })
      )
    } else {
      setMsg(r.error || t('turnReview.failed'))
    }
  }

  const files = expanded ? applied : applied.slice(0, 8)

  return (
    <div className="turn-review-bar" role="region" aria-label={t('turnReview.label')}>
      <div className="turn-review-left">
        <span className="turn-review-label">{t('turnReview.label')}</span>
        <span className="turn-review-meta" title={new Date(turn.createdAt).toLocaleString()}>
          {relativeTime(turn.createdAt, t)}
          {turn.label ? ` · ${turn.label}` : ''}
        </span>
        <span className="turn-review-count">{t('turnReview.files', { count: applied.length })}</span>
        <div className="turn-review-files">
          {files.map((c) => {
            const stats = computeChangeStats(c)
            return (
              <button
                key={c.path}
                type="button"
                className="turn-review-chip"
                title={`${c.path} (Click to inspect diff)`}
                onClick={() => {
                  openFileInPanel(c.path)
                  try {
                    ;(window as unknown as { __openRightPanelTab?: (id: string) => void }).__openRightPanelTab?.('diff')
                  } catch { /* ignore */ }
                }}
              >
                <span className="turn-review-op" data-op={c.op}>
                  {c.op === 'delete' ? '−' : c.op === 'write' && c.before == null ? '+' : '~'}
                </span>
                <span className="turn-review-fname">{(c.rel || c.path).split('/').pop()}</span>
                {stats && (
                  <span className={`turn-review-stat stat-${stats.kind}`}>
                    {stats.label}
                  </span>
                )}
              </button>
            )
          })}
          {applied.length > 8 && (
            <button
              type="button"
              className="turn-review-more"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t('turnReview.showLess') : t('turnReview.showMore', { count: applied.length - 8 })}
            </button>
          )}
        </div>
      </div>
      <div className="turn-review-actions">
        {msg && <span className="turn-review-msg">{msg}</span>}
        {sessionTurns.length > 1 && (
          <details className="turn-review-history">
            <summary>{t('turnReview.history', { count: sessionTurns.length })}</summary>
            <ul>
              {sessionTurns.slice(0, 8).map((tr) => (
                <li key={tr.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void undoTurn(tr.id)}
                    title={tr.label}
                  >
                    {relativeTime(tr.createdAt, t)} · {tr.changes.filter((c) => c.status === 'applied').length}f
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
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
        <button
          type="button"
          className="turn-review-undo"
          disabled={busy}
          onClick={() => void undoTurn()}
          title={t('turnReview.undoTurnHint')}
        >
          {busy ? t('turnReview.undoing') : t('turnReview.undoTurn')}
        </button>
      </div>
      {pending && (
        <ConfirmDialog
          title={t('turnReview.conflictTitle')}
          message={t('turnReview.conflictMessage', { count: pending.conflicts.length })}
          details={
            <ul>
              {pending.conflicts.map((c) => (
                <li key={c.path}>
                  <code title={c.path}>{c.path.split('/').slice(-2).join('/')}</code>
                  <span className="confirm-reason">{t(`turnReview.conflictReason.${c.reason}`)}</span>
                </li>
              ))}
            </ul>
          }
          cancelLabel={t('common.cancel')}
          secondaryLabel={
            pending.conflicts.length < applied.length ? t('turnReview.revertSafeOnly') : undefined
          }
          onSecondary={() => void undoTurn(pending.turnId, 'skip')}
          confirmLabel={t('turnReview.overwriteAll')}
          onConfirm={() => void undoTurn(pending.turnId, 'force')}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
