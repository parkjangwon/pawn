import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { computeDiff, type DiffResult } from '../utils/diff'
import './DiffView.css'

interface DiffViewProps {
  oldText: string
  newText: string
  filename?: string
  maxLines?: number
}

export default function DiffView({ oldText, newText, filename, maxLines = 100 }: DiffViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const diff = useMemo(() => computeDiff(oldText, newText), [oldText, newText])

  const lines = showAll ? diff.lines : diff.lines.slice(0, maxLines)
  const truncated = diff.lines.length > maxLines && !showAll

  const fromLine = diff.lines.find((l) => l.oldLine !== null)?.oldLine || 1
  const toLine = [...diff.lines].reverse().find((l) => l.newLine !== null)?.newLine || 1

  return (
    <div className={`diff-view ${collapsed ? 'collapsed' : ''}`}>
      <div className="diff-header" onClick={() => setCollapsed(!collapsed)}>
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
              Show all {diff.lines.length} lines ({diff.lines.length - maxLines} more)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
