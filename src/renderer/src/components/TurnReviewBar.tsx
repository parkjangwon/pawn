import { useMemo, useState } from 'react'
import { tx } from '../i18n'
import { Terminal } from 'lucide-react'
import { useChangeLedger, type RevertConflict } from '../stores/changeLedger'
import { focusDiffInPanel } from '../stores/filesPanel'
import ConfirmDialog from './ConfirmDialog'
import { formatMessageTimeFull } from '../utils/messageTime'
import './TurnReviewBar.css'

function relativeTime(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 45) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function computeChangeStats(c: { before?: string | null; after?: string; op: string }): { label: string; kind: 'add' | 'del' | 'mod' } | null {
  if (c.op === 'delete') {
    const lines = c.before ? c.before.split('\n').length : 0
    return { label: `-${lines}`, kind: 'del' }
  }
  if (c.op === 'write' && c.before == null) {
    if (c.after == null) return { label: '+', kind: 'add' } // binary / large file a command created
    const lines = c.after ? c.after.replace(/\n$/, '').split('\n').length : 0
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
          ? `Reverted ${r.reverted} files, kept ${r.skipped} you changed`
          : `Reverted ${r.reverted} files`
      )
    } else {
      // Internal reasons are English diagnostics: show the localized message, keep the detail in the tooltip.
      setMsg('Revert failed')
      if (r.error) console.warn('[undo]', r.error)
    }
  }

  const files = expanded ? applied : applied.slice(0, 8)
  // "Show in Finder": the produced file (one file) or their shared folder.
  const kept = applied.filter((c) => c.op !== 'delete')
  const revealTarget = (() => {
    if (kept.length === 0) return null
    if (kept.length === 1) return kept[0].path
    const dirs = new Set(kept.map((c) => c.path.slice(0, c.path.lastIndexOf('/'))))
    return dirs.size === 1 ? [...dirs][0] : null
  })()

  return (
    <div className="turn-review-bar" role="region" aria-label={'Files the agent changed'}>
      <div className="turn-review-left">
        <span className="turn-review-label">{'Files the agent changed'}</span>
        <span className="turn-review-meta" title={formatMessageTimeFull(turn.createdAt, 'en') || ''}>
          {relativeTime(turn.createdAt)}
          {turn.label ? ` · ${turn.label}` : ''}
        </span>
        <span className="turn-review-count">{`${applied.length} files`}</span>
        <div className="turn-review-files">
          {files.map((c) => {
            const stats = computeChangeStats(c)
            return (
              <button
                key={c.path}
                type="button"
                className="turn-review-chip"
                title={`${c.path}\n${c.byCommand ? 'Created by a command' : 'Click to view the diff'}`}
                onClick={() => focusDiffInPanel(c.path)}
              >
                <span className="turn-review-op" data-op={c.op}>
                  {c.op === 'delete' ? '−' : c.op === 'write' && c.before == null ? '+' : '~'}
                </span>
                <span className="turn-review-fname">{(c.rel || c.path).split('/').pop()}</span>
                {c.byCommand && (
                  <Terminal size={10} className="turn-review-by-cmd" role="img" aria-label={'Created by a command'} />
                )}
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
              {expanded ? 'Show less' : `+${applied.length - 8} more`}
            </button>
          )}
        </div>
      </div>
      <div className="turn-review-actions">
        {msg && <span className="turn-review-msg">{msg}</span>}
        {sessionTurns.length > 1 && (
          <details className="turn-review-history">
            <summary>{`History (${sessionTurns.length})`}</summary>
            <ul>
              {sessionTurns.slice(0, 8).map((tr) => (
                <li key={tr.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void undoTurn(tr.id)}
                    title={tr.label}
                  >
                    {relativeTime(tr.createdAt)} · {`${tr.changes.filter((c) => c.status === 'applied').length} files`}
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
          {'View changes'}
        </button>
        {revealTarget && (
          <button
            type="button"
            className="turn-review-diff"
            title={revealTarget}
            onClick={() => void window.api.workspace?.reveal?.(revealTarget)?.catch?.(() => {})}
          >
            {window.api?.platform === 'darwin' ? 'Show in Finder' : 'Show in folder'}
          </button>
        )}
        <button
          type="button"
          className="turn-review-undo"
          disabled={busy}
          onClick={() => void undoTurn()}
          title={'Restore the files this answer changed'}
        >
          {busy ? 'Reverting…' : 'Undo these changes'}
        </button>
      </div>
      {pending && (
        <ConfirmDialog
          title={'Some files changed since the agent edited them'}
          message={`${pending.conflicts.length} files were modified after this answer (by you, a formatter, or a later answer). Reverting them would discard those changes.`}
          details={
            <ul>
              {pending.conflicts.map((c) => (
                <li key={c.path}>
                  <code title={c.path}>{c.path.split('/').slice(-2).join('/')}</code>
                  <span className="confirm-reason">{tx(`turnReview.conflictReason.${c.reason}`)}</span>
                </li>
              ))}
            </ul>
          }
          cancelLabel={'Cancel'}
          secondaryLabel={
            pending.conflicts.length < applied.length ? 'Revert the rest' : undefined
          }
          onSecondary={() => void undoTurn(pending.turnId, 'skip')}
          confirmLabel={'Overwrite anyway'}
          onConfirm={() => void undoTurn(pending.turnId, 'force')}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
