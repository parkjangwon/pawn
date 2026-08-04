import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGitSummary } from '../hooks/useGitSummary'

interface GitSummaryChipProps {
  projectPath: string
}

const BRANCH_ICON_PATH = (
  <>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </>
)

/**
 * Live git status chip for the composer bar: branch name + working-tree
 * diff stat at a glance, with a popover for branch switching and quick
 * jumps into the right panel's Git/Diff tabs — the "environment" summary
 * pattern from Codex/Claude, scoped to this app's existing right panel
 * instead of duplicating its commit/push UI.
 */
export default function GitSummaryChip({ projectPath }: GitSummaryChipProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const summary = useGitSummary(projectPath)
  const [open, setOpen] = useState(false)
  const [showBranches, setShowBranches] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setShowBranches(false)
        setError(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggleBranches = (): void => {
    if (!showBranches) {
      window.api.shell.exec('git branch', projectPath)
        .then((r) => {
          if (r.exitCode === 0) {
            setBranches(r.stdout.trim().split('\n').map((l) => l.replace(/^\*?\s+/, '')).filter(Boolean))
          }
        })
        .catch(() => {})
    }
    setShowBranches((v) => !v)
  }

  const checkout = async (name: string): Promise<void> => {
    if (busy || name === summary.branch) return
    setBusy(true)
    setError(null)
    // execFile keeps the branch name out of any shell, so a repo-controlled
    // branch name cannot inject commands.
    const r = await window.api.shell.execFile('git', ['checkout', name], projectPath)
    setBusy(false)
    if (r.exitCode === 0) {
      summary.refresh()
      setShowBranches(false)
    } else {
      setError(r.stderr || r.stdout || t('rightPanel.git.checkoutFailed'))
    }
  }

  const openPanelTab = (id: 'git' | 'diff'): void => {
    ;(window as any).__openRightPanelTab?.(id)
    setOpen(false)
  }

  if (!summary.isRepo || !summary.branch) return null

  const dirty = summary.filesChanged > 0
  const inSync = summary.ahead === 0 && summary.behind === 0

  return (
    <div className="context-chip-wrapper git-chip-wrapper" ref={wrapperRef}>
      <button
        className={`context-chip git-chip ${dirty ? 'dirty' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={t('rightPanel.branch')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{BRANCH_ICON_PATH}</svg>
        <span>{summary.branch}</span>
        {!inSync && (
          <span className="git-chip-sync">
            {summary.ahead > 0 && <span>↑{summary.ahead}</span>}
            {summary.behind > 0 && <span>↓{summary.behind}</span>}
          </span>
        )}
        {dirty && (
          <span className="git-chip-stat">
            <span className="git-stat-ins">+{summary.insertions}</span>
            <span className="git-stat-del">-{summary.deletions}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="git-chip-popover">
          <button className="git-popover-branch" onClick={toggleBranches} disabled={busy}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{BRANCH_ICON_PATH}</svg>
            <span className="git-popover-branch-name">{summary.branch}</span>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`git-popover-chevron ${showBranches ? 'expanded' : ''}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showBranches && (
            <div className="git-branch-list">
              {branches.length === 0 && <div className="git-branch-empty">{t('rightPanel.git.noBranches')}</div>}
              {branches.map((b) => (
                <button key={b} className={`git-branch-item ${b === summary.branch ? 'active' : ''}`} onClick={() => checkout(b)} disabled={busy}>
                  {b === summary.branch && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                  <span>{b}</span>
                </button>
              ))}
            </div>
          )}

          {error && <div className="git-popover-error">{error}</div>}

          <div className="git-popover-divider" />

          <button className="git-popover-row" onClick={() => openPanelTab('diff')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            <span>{t('rightPanel.changes')}</span>
            <span className="git-popover-spacer" />
            {dirty ? (
              <span className="git-chip-stat">
                <span className="git-stat-ins">+{summary.insertions}</span>
                <span className="git-stat-del">-{summary.deletions}</span>
              </span>
            ) : (
              <span className="git-popover-muted">{t('rightPanel.git.noChanges')}</span>
            )}
          </button>

          <button className="git-popover-row" onClick={() => openPanelTab('git')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span>{t('rightPanel.tools.git')}</span>
            <span className="git-popover-spacer" />
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}
