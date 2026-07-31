import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/app'
import { useTranslation } from 'react-i18next'

interface GitFile {
  path: string
  status: string
  name: string
}

interface GitViewProps {
  projectPath: string
}

export default function GitView({ projectPath }: GitViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [branch, setBranch] = useState<string | null>(null)
  const [files, setFiles] = useState<GitFile[]>([])
  const [summary, setSummary] = useState({ added: 0, modified: 0, deleted: 0 })
  const [branches, setBranches] = useState<string[]>([])
  const [showBranches, setShowBranches] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!projectPath) { setBranch(null); setFiles([]); return }

    window.api.shell.exec('git rev-parse --abbrev-ref HEAD', projectPath)
      .then((r) => { if (r.exitCode === 0) setBranch(r.stdout.trim()); else setBranch(null) })
      .catch(() => setBranch(null))

    window.api.shell.exec('git status --porcelain', projectPath)
      .then((r) => {
        if (r.exitCode !== 0) { setFiles([]); return }
        const lines = r.stdout.trim().split('\n').filter(Boolean)
        const parsed: GitFile[] = lines.map((line) => {
          const status = line.substring(0, 2).trim()
          const path = line.substring(3).trim()
          return { path, status: status[0] || 'M', name: path.split('/').pop() || path }
        })
        setFiles(parsed)
        setSummary({
          added: parsed.filter((f) => f.status === '?' || f.status === 'A').length,
          modified: parsed.filter((f) => f.status === 'M').length,
          deleted: parsed.filter((f) => f.status === 'D').length
        })
      })
      .catch(() => setFiles([]))
  }, [projectPath])

  // Load branches and history
  useEffect(() => {
    if (!projectPath) return
    window.api.shell.exec('git branch', projectPath).then((r) => {
      if (r.exitCode === 0) setBranches(r.stdout.trim().split('\n').map((l) => l.replace(/^\*?\s+/, '')))
    }).catch(() => {})
    window.api.shell.exec('git log --oneline -15', projectPath).then((r) => {
      if (r.exitCode === 0) setHistory(r.stdout.trim().split('\n').filter(Boolean))
    }).catch(() => {})
  }, [projectPath])

  const checkoutBranch = async (name: string): Promise<void> => {
    setBusy(true)
    const r = await window.api.shell.exec(`git checkout ${name}`, projectPath)
    if (r.exitCode === 0) setBranch(name)
    setShowBranches(false)
    setBusy(false)
  }

  const doCommit = async (): Promise<void> => {
    if (!commitMessage.trim()) return
    setBusy(true)
    await window.api.shell.exec('git add -A', projectPath)
    await window.api.shell.exec(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, projectPath)
    setCommitMessage('')
    setBusy(false)
  }

  const doPush = async (): Promise<void> => {
    setBusy(true)
    await window.api.shell.exec('git push', projectPath)
    setBusy(false)
  }

  const statusLabel: Record<string, string> = { 'M': 'M', 'A': 'A', 'D': 'D', '?': 'U' }

  if (!projectPath || !branch) {
    return <div className="rp-empty">{t('rightPanel.git.noRepo')}</div>
  }

  return (
    <div className="rp-git">
      <div className="rp-git-header">
        <div className="rp-git-info" onClick={() => setShowBranches(!showBranches)} style={{ cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="rp-git-branch">{branch}</span>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </div>
        {showBranches && (
          <div className="rp-git-branch-list">
            {branches.map((b) => (
              <button key={b} className={`rp-git-branch-item ${b === branch ? 'active' : ''}`} onClick={() => checkoutBranch(b)} disabled={busy}>
                {b === branch && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
                <span>{b}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rp-git-body">
        {files.length === 0 && <div className="rp-files-empty">{t('rightPanel.git.noChanges')}</div>}
        {files.map((file) => (
          <div key={file.path} className="rp-git-file">
            <span className={`rp-git-file-status rp-git-status-${statusLabel[file.status] || 'M'}`}>
              {statusLabel[file.status] || '?'}
            </span>
            <span className="rp-git-file-name">{file.name}</span>
          </div>
        ))}
      </div>
      {files.length > 0 && (
        <div className="rp-git-summary">
          <span className="rp-git-summary-added">+{summary.added}</span>
          <span className="rp-git-summary-modified">~{summary.modified}</span>
          <span className="rp-git-summary-deleted">-{summary.deleted}</span>
        </div>
      )}
      <div className="rp-git-actions">
        <input className="rp-git-commit-input" placeholder="Commit message..." value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) doCommit() }} />
        <button className="rp-git-btn" onClick={doCommit} disabled={busy || !commitMessage.trim()}>Commit</button>
        <button className="rp-git-btn" onClick={doPush} disabled={busy}>Push</button>
      </div>
      {history.length > 0 && (
        <div className="rp-git-history">
          <div className="rp-git-history-header" onClick={() => setShowHistory(!showHistory)} style={{ cursor: 'pointer' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showHistory ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><polyline points="9 18 15 12 9 6" /></svg>
            History ({history.length})
          </div>
          {showHistory && (
            <div className="rp-git-history-list">
              {history.map((h, i) => <div key={i} className="rp-git-history-item">{h}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
