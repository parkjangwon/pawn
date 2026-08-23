import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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

  const onRevert = async (): Promise<void> => {
    if (!openPath) {
      setActionMsg(t('diffView.noPath'))
      return
    }
    const r = await useChangeLedger.getState().revertFile(openPath)
    setActionMsg(r.ok ? t('diffView.reverted') : r.error || t('diffView.revertFailed'))
  }

  const onReveal = (): void => {
    if (openPath) void window.api?.workspace?.reveal?.(openPath)?.catch?.(() => {})
  }

  return (
    <div className={`diff-view ${collapsed ? 'collapsed' : ''}`}>
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
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`diff-chevron ${collapsed ? '' : 'expanded'}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
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
