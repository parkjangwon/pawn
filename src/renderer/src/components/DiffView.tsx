import { useState, useMemo } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { useTranslation } from 'react-i18next'
import { ChevronRight, GitCompare } from 'lucide-react'
import { computeDiff } from '../utils/diff'
import { useChangeLedger } from '../stores/changeLedger'
import { openFileInPanel } from '../stores/filesPanel'
import './DiffView.css'

interface DiffViewProps {
  oldText: string
  newText: string
  filename?: string
  path?: string
  maxLines?: number
  showActions?: boolean
}

export default function DiffView({
  oldText,
  newText,
  filename,
  path,
  maxLines = 100,
  showActions = true
}: DiffViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const diff = useMemo(() => computeDiff(oldText, newText), [oldText, newText])
  const lines = showAll ? diff.lines : diff.lines.slice(0, maxLines)
  const truncated = diff.lines.length > maxLines && !showAll
  const openPath = path || undefined

  const onOpen = (): void => {
    if (openPath) openFileInPanel(openPath)
  }

  // Conflict overwrite needs explicit opt-in — same staged flow as the turn
  // review bar, via ConfirmDialog instead of a bare window.confirm.
  const [confirmForce, setConfirmForce] = useState<string | null>(null)

  const onRevert = async (): Promise<void> => {
    if (!openPath) {
      setActionMsg(t('diffView.noPath'))
      return
    }
    const r = await useChangeLedger.getState().revertFile(openPath)
    if (!r.ok && r.conflict && r.conflict !== 'oversized') {
      // Changed after the agent's edit — make the user opt in to overwriting.
      setConfirmForce(openPath)
      return
    }
    setActionMsg(r.ok ? t('diffView.reverted') : t('diffView.revertFailed'))
    if (!r.ok && r.error) console.warn('[revert]', r.error)
  }

  const forceRevert = async (target: string): Promise<void> => {
    const forced = await useChangeLedger.getState().revertFile(target, { force: true })
    setActionMsg(forced.ok ? t('diffView.reverted') : forced.error || t('diffView.revertFailed'))
  }

  const onReveal = (): void => {
    if (openPath) void window.api?.workspace?.reveal?.(openPath)?.catch?.(() => {})
  }

  return (
    <div className={`diff-view ${collapsed ? 'collapsed' : ''}`}>
      {confirmForce && (
        <ConfirmDialog
          title={t('diffView.revertConflictTitle')}
          message={t('diffView.revertConflict')}
          confirmLabel={t('diffView.revertForce')}
          danger
          onConfirm={() => {
            const target = confirmForce
            setConfirmForce(null)
            void forceRevert(target)
          }}
          onCancel={() => {
            setConfirmForce(null)
            setActionMsg(t('diffView.revertCancelled'))
          }}
        />
      )}
      <div
        className="diff-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(!collapsed)
          }
        }}
      >
        <div className="diff-header-left">
          <ChevronRight
            size={12}
            className={`diff-chevron ${collapsed ? '' : 'expanded'}`}
          />
          <GitCompare size={14} />
          <span className="diff-filename">{filename || 'file'}</span>
        </div>
        <div className="diff-stats">
          <span className="diff-stat-added">+{diff.added}</span>
          <span className="diff-stat-removed">-{diff.removed}</span>
        </div>
      </div>
      {showActions && (openPath || filename) && (
        <div className="diff-actions" onClick={(e) => e.stopPropagation()}>
          {openPath && (
            <button type="button" className="diff-action-btn" onClick={onOpen}>
              {t('diffView.open')}
            </button>
          )}
          {openPath && (
            <button type="button" className="diff-action-btn" onClick={onReveal}>
              {t('diffView.reveal')}
            </button>
          )}
          {openPath && (
            <button type="button" className="diff-action-btn diff-action-revert" onClick={() => void onRevert()}>
              {t('diffView.revert')}
            </button>
          )}
          {actionMsg && <span className="diff-action-msg">{actionMsg}</span>}
        </div>
      )}
      {!collapsed && (
        <div className="diff-body">
          {lines.map((line, i) => (
            <div key={i} className={`diff-line diff-line-${line.type}`}>
              <span className="diff-line-num diff-line-num-old">
                {line.oldLine ?? ''}
              </span>
              <span className="diff-line-num diff-line-num-new">
                {line.newLine ?? ''}
              </span>
              <span className="diff-line-prefix">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              <span className="diff-line-text">{line.text || ' '}</span>
            </div>
          ))}
          {truncated && (
            <button className="diff-show-more" onClick={() => setShowAll(true)}>
              {t('diffView.showAll', { total: diff.lines.length, extra: diff.lines.length - maxLines })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
