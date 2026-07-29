import { useAppStore } from '../stores/app'

export default function DiffListView(): React.JSX.Element {
  const { projects, activeProjectId, activeSessionId } = useAppStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages || []

  // Find system messages with diff data
  const diffMessages = messages.filter((m) => m.role === 'system' && m.content.startsWith('__DIFF__:'))

  if (diffMessages.length === 0) {
    return (
      <div className="rp-diff">
        <div className="rp-diff-header">
          Recent Changes
        </div>
        <div className="rp-diff-list">
          <div className="rp-diff-empty">No recent file changes</div>
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
          const newlineIdx = msg.content.indexOf('\n')
          const diffJson = newlineIdx > 0 ? msg.content.slice(9, newlineIdx) : msg.content.slice(9)
          try {
            const diff = JSON.parse(diffJson)
            return (
              <div key={msg.id} className="rp-diff-item">
                <svg className="rp-diff-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
                <div className="rp-diff-item-info">
                  <div className="rp-diff-item-name">{diff.filename || 'file'}</div>
                  <div className="rp-diff-item-desc">{diff.oldText?.length || 0} → {diff.newText?.length || 0} chars</div>
                </div>
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
