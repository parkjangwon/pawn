import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import DiffView from './DiffView'

export default function DiffListView(): React.JSX.Element {
  const { t } = useTranslation()
  const { projects, activeProjectId, activeSessionId } = useAppStore()
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []

  // Find system messages with diff data
  const diffMessages = messages.filter((m) => m.role === 'system' && m.content.startsWith('__DIFF__:'))

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

  return (
    <div className="rp-diff">
      <div className="rp-diff-header">
        Recent Changes ({diffMessages.length})
      </div>
      <div className="rp-diff-list">
        {[...diffMessages].reverse().map((msg, i) => {
          const markerIdx = msg.content.indexOf('__DIFF__:')
          if (markerIdx < 0) return null
          const diffJson = msg.content.slice(markerIdx + 9).split('\n')[0]
          try {
            const diff = JSON.parse(diffJson)
            const isExpanded = expandedIdx === i
            return (
              <div key={msg.id}>
                <div className="rp-diff-item" onClick={() => setExpandedIdx(isExpanded ? null : i)}>
                  <svg className="rp-diff-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                  </svg>
                  <div className="rp-diff-item-info">
                    <div className="rp-diff-item-name">{diff.filename || 'file'}</div>
                    <div className="rp-diff-item-desc">{diff.oldText?.length || 0} → {diff.newText?.length || 0} chars</div>
                  </div>
                </div>
                {isExpanded && (
                  <div className="rp-diff-expanded">
                    <DiffView oldText={diff.oldText} newText={diff.newText} filename={diff.filename} maxLines={80} />
                  </div>
                )}
              </div>
            )
          } catch {
            return null
          }
        })}
      </div>
    </div>
  )
}
