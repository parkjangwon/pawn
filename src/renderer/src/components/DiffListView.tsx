import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import DiffView from './DiffView'
import { DIFF_MARKER, parseDiffMarker } from '../utils/diffMarker'
import { openFileInPanel, useFilesPanelStore } from '../stores/filesPanel'
import { useChangeLedger } from '../stores/changeLedger'

export default function DiffListView(): React.JSX.Element {
  const { t } = useTranslation()
  const { projects, activeProjectId, activeSessionId } = useAppStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []
  const projectPath = getEffectiveProjectPath(activeProject, activeSessionId)

  const diffMessages = messages.filter((m) => m.role === 'system' && m.content.includes(DIFF_MARKER))
  const listRef = useRef<HTMLDivElement>(null)

  const resolvePath = (filename?: string, path?: string): string | undefined => {
    if (path) return path
    if (!filename) return undefined
    if (filename.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filename)) return filename
    if (projectPath) return projectPath.replace(/\/$/, '') + '/' + filename
    return undefined
  }

  // "Agent changes" chip → expand that file's latest diff (or the ledger entry
  // for files a command created, which have no tool diff message).
  const diffFocus = useFilesPanelStore((s) => s.diffFocus)
  const [ledgerFocus, setLedgerFocus] = useState<{ path: string; before: string; after: string; binary?: boolean } | null>(null)
  useEffect(() => {
    if (!diffFocus) return
    const hit = [...diffMessages].reverse().find((m) => {
      const d = parseDiffMarker(m.content)
      return d && resolvePath(d.filename, d.path) === diffFocus.path
    })
    if (hit) {
      setLedgerFocus(null)
      setExpandedId(hit.id)
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-diff-id="${hit.id}"]`)?.scrollIntoView({ block: 'start' }))
      return
    }
    const turn = useChangeLedger.getState().latestTurn(activeSessionId)
    const c = turn?.changes.find((x) => x.path === diffFocus.path && x.status === 'applied')
    setExpandedId(null)
    setLedgerFocus(c ? { path: c.path, before: c.before ?? '', after: c.after ?? '', binary: c.after === undefined && c.op !== 'delete' } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffFocus?.token])

  if (diffMessages.length === 0 && !ledgerFocus) {
    return (
      <div className="rp-diff">
        <div className="rp-diff-header">
          {t('rightPanel.diff.title')}
        </div>
        <div className="rp-diff-list">
          <div className="rp-diff-empty">{t('rightPanel.diff.empty')}</div>
          <div className="rp-diff-empty-hint">{t('diff.emptyHint')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rp-diff">
      <div className="rp-diff-header">
        {`${t('rightPanel.diff.title')} (${diffMessages.length + (ledgerFocus ? 1 : 0)})`}
      </div>
      <div className="rp-diff-list" ref={listRef}>
        {ledgerFocus && (
          <div className="rp-diff-expanded" data-diff-id="ledger">
            {ledgerFocus.binary ? (
              <div className="rp-diff-binary">
                <span className="rp-diff-binary-name">{ledgerFocus.path.split('/').pop()}</span>
                <span>{t('rightPanel.diff.noTextPreview')}</span>
                <button type="button" className="rp-diff-binary-open" onClick={() => openFileInPanel(ledgerFocus.path)}>
                  {t('rightPanel.diff.open')}
                </button>
              </div>
            ) : (
            <DiffView
              oldText={ledgerFocus.before}
              newText={ledgerFocus.after}
              filename={ledgerFocus.path.split('/').pop()}
              path={ledgerFocus.path}
              maxLines={80}
            />
            )}
          </div>
        )}
        {[...diffMessages].reverse().map((msg) => {
          const diff = parseDiffMarker(msg.content)
          if (!diff) return null
          const isExpanded = expandedId === msg.id
          const abs = resolvePath(diff.filename, diff.path)
          return (
            <div key={msg.id} data-diff-id={msg.id}>
              <div
                className="rp-diff-item"
                onClick={() => setExpandedId(isExpanded ? null : msg.id)}
              >
                <svg className="rp-diff-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
                <div className="rp-diff-item-info">
                  <div className="rp-diff-item-name">{diff.filename || 'file'}</div>
                  <div className="rp-diff-item-desc">
                    {(() => {
                      const a = diff.oldText ? diff.oldText.replace(/\n$/, '').split('\n').length : 0
                      const b = diff.newText ? diff.newText.replace(/\n$/, '').split('\n').length : 0
                      const delta = b - a
                      const sign = delta > 0 ? '+' : ''
                      return `${a} → ${b} lines (${sign}${delta})`
                    })()}
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="rp-diff-expanded">
                  <DiffView
                    oldText={diff.oldText}
                    newText={diff.newText}
                    filename={diff.filename}
                    path={abs}
                    maxLines={80}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
