import { useState, useEffect } from 'react'

interface GitFile {
  path: string
  status: string
  name: string
}

interface GitViewProps {
  projectPath: string
}

export default function GitView({ projectPath }: GitViewProps): React.JSX.Element {
  const [branch, setBranch] = useState<string | null>(null)
  const [files, setFiles] = useState<GitFile[]>([])
  const [summary, setSummary] = useState({ added: 0, modified: 0, deleted: 0 })

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

  const statusLabel: Record<string, string> = { 'M': 'M', 'A': 'A', 'D': 'D', '?': 'U' }

  if (!projectPath || !branch) {
    return <div className="rp-empty">No git repository</div>
  }

  return (
    <div className="rp-git">
      <div className="rp-git-header">
        <div className="rp-git-info">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="rp-git-branch">{branch}</span>
        </div>
      </div>
      <div className="rp-git-body">
        {files.length === 0 && <div className="rp-files-empty">No changes</div>}
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
    </div>
  )
}
