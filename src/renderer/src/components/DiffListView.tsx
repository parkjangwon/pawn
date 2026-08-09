import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import DiffView from './DiffView'
import { DIFF_MARKER, parseDiffMarker } from '../utils/diffMarker'

export default function DiffListView(): React.JSX.Element {
  const { t } = useTranslation()
  const { projects, activeProjectId, activeSessionId } = useAppStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []
  const projectPath = getEffectiveProjectPath(activeProject, activeSessionId)

  const diffMessages = messages.filter((m) => m.role === 'system' && m.content.includes(DIFF_MARKER))

  if (diffMessages.length === 0) {
    return (
      <div className="rp-diff">
        <div className="rp-diff-header">
          {t('rightPanel.diff.title')}
        </div>
        <div className="rp-diff-list">
          <div className="rp-diff-empty">{t('rightPanel.diff.empty')}</div>
        </div>
      </div>
    )
  }

  const resolvePath = (filename?: string, path?: string): string | undefined => {
    if (path) return path
    if (!filename) return undefined
    if (filename.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filename)) return filename
    if (projectPath) return projectPath.replace(/\/$/, '') + '/' + filename
    return undefined
  }

  return (
    <div className="rp-diff">
      <div className="rp-diff-header">
        {`${t('rightPanel.diff.title')} (${diffMessages.length})`}
      </div>
      <div className="rp-diff-list">
        {[...diffMessages].reverse().map((msg) => {
          const diff = parseDiffMarker(msg.content)
          if (!diff) return null
          const isExpanded = expandedId === msg.id
          const abs = resolvePath(diff.filename, diff.path)
          return (
            <div key={msg.id}>
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
                    {diff.oldText.length || 0} → {diff.newText.length || 0} chars
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
