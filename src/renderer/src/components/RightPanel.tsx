import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/app'
import './RightPanel.css'

export default function RightPanel(): React.JSX.Element | null {
  const { projects, activeProjectId, activeSessionId } = useAppStore()
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [gitStatus, setGitStatus] = useState<{ added: number; deleted: number } | null>(null)
  const [visible, setVisible] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = activeProject?.sessions.find((s) => s.id === activeSessionId)
  const effectivePath = activeSession?.path || activeProject?.path || ''

  useEffect(() => {
    if (!effectivePath) {
      setGitBranch(null)
      setGitStatus(null)
      return
    }
    window.api.shell.exec('git rev-parse --abbrev-ref HEAD', effectivePath)
      .then((r) => { if (r.exitCode === 0) { setGitBranch(r.stdout.trim()); setVisible(true) } else setGitBranch(null) })
      .catch(() => setGitBranch(null))

    window.api.shell.exec('git status --porcelain', effectivePath)
      .then((r) => {
        if (r.exitCode === 0) {
          const lines = r.stdout.trim().split('\n').filter(Boolean)
          const added = lines.filter((l) => l.startsWith('A') || l.startsWith('M') || l.startsWith('??')).length
          const deleted = lines.filter((l) => l.startsWith('D')).length
          setGitStatus({ added, deleted })
        }
      })
      .catch(() => setGitStatus(null))
  }, [effectivePath])

  if (!visible || !gitBranch) return null

  return (
    <aside className="right-panel">
      <div className="rp-header">
        <span className="rp-title">Environment</span>
        <button className="rp-close" onClick={() => setVisible(false)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <div className="rp-section">
        <div className="rp-row">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
          <span className="rp-label">Changes</span>
          <span className="rp-value changes">
            {gitStatus && (gitStatus.added > 0 || gitStatus.deleted > 0) ? (
              <><span className="added">+{gitStatus.added}</span> <span className="deleted">-{gitStatus.deleted}</span></>
            ) : '0'}
          </span>
        </div>
        <div className="rp-row">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
          <span className="rp-label">Local</span>
        </div>
        <div className="rp-row">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
          <span className="rp-label">Branch</span>
          <span className="rp-value branch">{gitBranch}</span>
        </div>
      </div>

      {activeProject && (
        <div className="rp-section">
          <div className="rp-row">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            <span className="rp-label">Project</span>
            <span className="rp-value">{activeProject.name}</span>
          </div>
          {effectivePath && (
            <div className="rp-row path-row">
              <span className="rp-path">{effectivePath}</span>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
