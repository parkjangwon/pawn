import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { secretPreflight, validateCommitMessage } from '../agent/gitWrite'
import { scanForSecrets, formatSecretScanBlock } from '../agent/secretScan'

interface GitFile {
  path: string
  /** XY porcelain codes; first char index, second worktree */
  index: string
  worktree: string
  name: string
  staged: boolean
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
  const [error, setError] = useState<string | null>(null)
  const [remoteHint, setRemoteHint] = useState<string | null>(null)
  const [prBusy, setPrBusy] = useState(false)

  const refreshStatus = useCallback((): void => {
    if (!projectPath) {
      setBranch(null)
      setFiles([])
      return
    }
    window.api.shell
      .exec('git rev-parse --abbrev-ref HEAD', projectPath)
      .then((r) => {
        if (r.exitCode === 0) setBranch(r.stdout.trim())
        else setBranch(null)
      })
      .catch(() => setBranch(null))

    window.api.shell
      .exec('git status --porcelain', projectPath)
      .then((r) => {
        if (r.exitCode !== 0) {
          setFiles([])
          return
        }
        const lines = r.stdout.trim().split('\n').filter(Boolean)
        const parsed: GitFile[] = lines.map((line) => {
          const index = line[0] || ' '
          const worktree = line[1] || ' '
          const path = line.substring(3).trim().replace(/^"/, '').replace(/"$/, '')
          const staged = index !== ' ' && index !== '?'
          return {
            path,
            index,
            worktree,
            name: path.split('/').pop() || path,
            staged
          }
        })
        setFiles(parsed)
        setSummary({
          added: parsed.filter((f) => f.index === 'A' || f.index === '?' || f.worktree === '?').length,
          modified: parsed.filter((f) => f.index === 'M' || f.worktree === 'M').length,
          deleted: parsed.filter((f) => f.index === 'D' || f.worktree === 'D').length
        })
      })
      .catch(() => setFiles([]))

    window.api.shell
      .exec('git branch', projectPath)
      .then((r) => {
        if (r.exitCode === 0) {
          setBranches(r.stdout.trim().split('\n').map((l) => l.replace(/^\*?\s+/, '')))
        }
      })
      .catch(() => {})
    window.api.shell
      .exec('git log --oneline -15', projectPath)
      .then((r) => {
        if (r.exitCode === 0) setHistory(r.stdout.trim().split('\n').filter(Boolean))
      })
      .catch(() => {})

    window.api.shell
      .exec('git remote get-url origin', projectPath)
      .then((r) => {
        if (r.exitCode !== 0) {
          setRemoteHint(null)
          return
        }
        const url = r.stdout.trim()
        const m =
          url.match(/github\.com[:/]([^/]+)\/([^/.]+)/i) ||
          url.match(/github\.com\/([^/]+)\/([^/.]+)/i)
        setRemoteHint(m ? `${m[1]}/${m[2]}` : null)
      })
      .catch(() => setRemoteHint(null))
  }, [projectPath])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!projectPath) return
    const onFocus = (): void => refreshStatus()
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(refreshStatus, 4000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [projectPath, refreshStatus])

  const checkoutBranch = async (name: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await window.api.shell.execFile('git', ['checkout', name], projectPath)
    if (r.exitCode === 0) setBranch(name)
    else setError(r.stderr || r.stdout || t('rightPanel.git.errCheckout', { code: r.exitCode }))
    setShowBranches(false)
    setBusy(false)
  }

  const stageFile = async (path: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await window.api.shell.execFile('git', ['add', '--', path], projectPath)
    if (r.exitCode !== 0) setError(r.stderr || r.stdout || t('rightPanel.git.errStage'))
    refreshStatus()
    setBusy(false)
  }

  const unstageFile = async (path: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await window.api.shell.execFile(
      'git',
      ['restore', '--staged', '--', path],
      projectPath
    )
    if (r.exitCode !== 0) {
      // Older git: reset HEAD
      const r2 = await window.api.shell.execFile(
        'git',
        ['reset', 'HEAD', '--', path],
        projectPath
      )
      if (r2.exitCode !== 0) setError(r2.stderr || r.stderr || t('rightPanel.git.errUnstage'))
    }
    refreshStatus()
    setBusy(false)
  }

  const stageAll = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await window.api.shell.execFile('git', ['add', '-A'], projectPath)
    if (r.exitCode !== 0) setError(r.stderr || r.stdout || t('rightPanel.git.errStage'))
    refreshStatus()
    setBusy(false)
  }

  const doCommit = async (): Promise<void> => {
    if (!commitMessage.trim()) return
    const msgErr = validateCommitMessage(commitMessage)
    if (msgErr) {
      setError(msgErr)
      return
    }
    setBusy(true)
    setError(null)
    const execFile = (
      file: string,
      args: string[],
      cwd?: string,
      timeoutMs?: number
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
      window.api.shell.execFile(file, args, cwd, timeoutMs)

    // Stage remaining unstaged only if nothing staged? Prefer explicit staged set.
    const hasStaged = files.some((f) => f.staged)
    if (!hasStaged) {
      const add = await window.api.shell.execFile('git', ['add', '-A'], projectPath)
      if (add.exitCode !== 0) {
        setError(add.stderr || add.stdout || t('rightPanel.git.errStage'))
        setBusy(false)
        return
      }
    }

    const secretErr = await secretPreflight(execFile, projectPath, commitMessage)
    if (secretErr) {
      setError(secretErr)
      setBusy(false)
      return
    }

    const commit = await window.api.shell.execFile(
      'git',
      ['commit', '-m', commitMessage],
      projectPath
    )
    if (commit.exitCode !== 0) {
      setError(commit.stderr || commit.stdout || t('rightPanel.git.errCommit', { code: commit.exitCode }))
    } else {
      setCommitMessage('')
      refreshStatus()
    }
    setBusy(false)
  }

  const doPush = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    // Soft secret scan of last commit message
    try {
      const log = await window.api.shell.execFile(
        'git',
        ['log', '-1', '--pretty=%B'],
        projectPath
      )
      const hits = scanForSecrets(log.stdout || '')
      if (hits.length) {
        setError(formatSecretScanBlock(hits))
        setBusy(false)
        return
      }
    } catch {
      /* continue */
    }
    const r = await window.api.shell.execFile('git', ['push'], projectPath)
    if (r.exitCode !== 0) setError(r.stderr || r.stdout || t('rightPanel.git.errPush', { code: r.exitCode }))
    setBusy(false)
  }

  const openPullRequest = async (): Promise<void> => {
    if (!remoteHint || !window.api?.connections?.runTool) {
      setError(t('rightPanel.git.prNeedGithub'))
      return
    }
    setPrBusy(true)
    setError(null)
    try {
      // Push first if needed
      const push = await window.api.shell.execFile('git', ['push', '-u', 'origin', 'HEAD'], projectPath)
      if (push.exitCode !== 0 && !/up-to-date|everything up-to-date/i.test(push.stderr + push.stdout)) {
        setError(push.stderr || push.stdout || t('rightPanel.git.errPush', { code: push.exitCode }))
        setPrBusy(false)
        return
      }
      const head = branch || 'HEAD'
      const title =
        commitMessage.trim() ||
        (history[0] ? history[0].replace(/^[a-f0-9]+\s+/i, '') : `Update ${head}`)
      const res = await window.api.connections.runTool('github_create_pull', {
        repo: remoteHint,
        title,
        head,
        base: 'main',
        body: `Opened from Pawn Git panel on branch \`${head}\`.`
      })
      if (!res?.ok) {
        // Try master as base
        const res2 = await window.api.connections.runTool('github_create_pull', {
          repo: remoteHint,
          title,
          head,
          base: 'master',
          body: `Opened from Pawn Git panel on branch \`${head}\`.`
        })
        if (!res2?.ok) {
          setError(res2?.error || res?.error || res?.text || t('rightPanel.git.errPr'))
        } else {
          setError(null)
          void window.api.notification?.send?.('Pawn', t('rightPanel.git.prOpened'))
          if (res2.text) setError(res2.text.slice(0, 200))
        }
      } else {
        void window.api.notification?.send?.('Pawn', t('rightPanel.git.prOpened'))
        if (res.text) setError(res.text.slice(0, 200))
      }
    } catch (e) {
      setError(String(e))
    }
    setPrBusy(false)
  }

  const statusBadge = (f: GitFile): string => {
    if (f.index === '?' || f.worktree === '?') return 'U'
    if (f.index === 'A' || f.worktree === 'A') return 'A'
    if (f.index === 'D' || f.worktree === 'D') return 'D'
    return 'M'
  }

  if (!projectPath || !branch) {
    return <div className="rp-empty">{t('rightPanel.git.noRepo')}</div>
  }

  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => !f.staged)

  return (
    <div className="rp-git">
      <div className="rp-git-header">
        <div
          className="rp-git-info"
          onClick={() => setShowBranches(!showBranches)}
          style={{ cursor: 'pointer' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="rp-git-branch">{branch}</span>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {showBranches && (
          <div className="rp-git-branch-list">
            {branches.map((b) => (
              <button
                key={b}
                className={`rp-git-branch-item ${b === branch ? 'active' : ''}`}
                onClick={() => void checkoutBranch(b)}
                disabled={busy}
              >
                {b === branch && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span>{b}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rp-git-body">
        {files.length === 0 && <div className="rp-files-empty">{t('rightPanel.git.noChanges')}</div>}

        {staged.length > 0 && (
          <div className="rp-git-section">
            <div className="rp-git-section-label">{t('rightPanel.git.staged')}</div>
            {staged.map((file) => (
              <div key={`s-${file.path}`} className="rp-git-file">
                <span className={`rp-git-file-status rp-git-status-${statusBadge(file)}`}>
                  {statusBadge(file)}
                </span>
                <span className="rp-git-file-name" title={file.path}>
                  {file.name}
                </span>
                <button
                  type="button"
                  className="rp-git-file-btn"
                  disabled={busy}
                  onClick={() => void unstageFile(file.path)}
                  title={t('rightPanel.git.unstage')}
                >
                  −
                </button>
              </div>
            ))}
          </div>
        )}

        {unstaged.length > 0 && (
          <div className="rp-git-section">
            <div className="rp-git-section-label">
              {t('rightPanel.git.unstaged')}
              <button
                type="button"
                className="rp-git-file-btn link"
                disabled={busy}
                onClick={() => void stageAll()}
              >
                {t('rightPanel.git.stageAll')}
              </button>
            </div>
            {unstaged.map((file) => (
              <div key={`u-${file.path}`} className="rp-git-file">
                <span className={`rp-git-file-status rp-git-status-${statusBadge(file)}`}>
                  {statusBadge(file)}
                </span>
                <span className="rp-git-file-name" title={file.path}>
                  {file.name}
                </span>
                <button
                  type="button"
                  className="rp-git-file-btn"
                  disabled={busy}
                  onClick={() => void stageFile(file.path)}
                  title={t('rightPanel.git.stage')}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="rp-git-summary">
          <span className="rp-git-summary-added">+{summary.added}</span>
          <span className="rp-git-summary-modified">~{summary.modified}</span>
          <span className="rp-git-summary-deleted">-{summary.deleted}</span>
        </div>
      )}
      {error && <div className="rp-git-error">{error}</div>}
      <div className="rp-git-actions">
        <input
          className="rp-git-commit-input"
          placeholder={t('rightPanel.git.commitPlaceholder')}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void doCommit()
          }}
        />
        <button
          className="rp-git-btn"
          onClick={() => void doCommit()}
          disabled={busy || !commitMessage.trim()}
        >
          {t('rightPanel.git.commit')}
        </button>
        <button className="rp-git-btn" onClick={() => void doPush()} disabled={busy}>
          {t('rightPanel.git.push')}
        </button>
        {remoteHint && (
          <button
            className="rp-git-btn primary"
            onClick={() => void openPullRequest()}
            disabled={busy || prBusy}
            title={t('rightPanel.git.openPrHint', { repo: remoteHint })}
          >
            {prBusy ? t('rightPanel.git.openingPr') : t('rightPanel.git.openPr')}
          </button>
        )}
      </div>
      {history.length > 0 && (
        <div className="rp-git-history">
          <div
            className="rp-git-history-header"
            onClick={() => setShowHistory(!showHistory)}
            style={{ cursor: 'pointer' }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: showHistory ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s'
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {t('rightPanel.git.history', { count: history.length })}
          </div>
          {showHistory && (
            <div className="rp-git-history-list">
              {history.map((h, i) => (
                <div key={i} className="rp-git-history-item">
                  {h}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
