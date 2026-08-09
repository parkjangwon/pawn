import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import {
  useSubagentRunsStore,
  sessionTotals,
  type SubagentRun
} from '../stores/subagentRuns'
import {
  spawnBackgroundSubagent,
  applyPendingWorktree,
  discardPendingWorktree
} from '../agent/subagent'
import './SubagentsView.css'

function elapsed(run: SubagentRun, now: number): string {
  const end = run.finishedAt || now
  const sec = Math.max(0, Math.round((end - run.startedAt) / 1000))
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

function statusClass(status: SubagentRun['status']): string {
  if (status === 'running') return 'running'
  if (status === 'ok') return 'ok'
  if (status === 'aborted') return 'aborted'
  return 'error'
}

type StatusFilter = 'all' | 'running' | 'done' | 'failed'

function progressPct(run: SubagentRun): number {
  if (run.status !== 'running') return run.status === 'ok' ? 100 : 0
  const max = Math.max(1, run.maxRounds || 12)
  return Math.min(95, Math.round((run.rounds / max) * 100))
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function SubagentsView(): React.JSX.Element {
  const { t } = useTranslation()
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const projectPath =
    projects.find((p) => p.id === activeProjectId)?.paths?.[0] || undefined
  const runs = useSubagentRunsStore((s) => s.runs)
  const cancel = useSubagentRunsStore((s) => s.cancel)
  const cancelAllForSession = useSubagentRunsStore((s) => s.cancelAllForSession)
  const clearFinished = useSubagentRunsStore((s) => s.clearFinished)
  const clearFinishedForSession = useSubagentRunsStore((s) => s.clearFinishedForSession)
  const [scope, setScope] = useState<'session' | 'all'>('session')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [runs])

  const scoped = useMemo(() => {
    if (scope === 'all' || !activeSessionId) return runs
    return runs.filter((r) => r.parentSessionId === activeSessionId)
  }, [runs, scope, activeSessionId])

  const stats = useMemo(() => sessionTotals(scoped), [scoped])

  const list = useMemo(() => {
    let rows = scoped
    if (statusFilter === 'running') rows = rows.filter((r) => r.status === 'running')
    else if (statusFilter === 'done') rows = rows.filter((r) => r.status === 'ok')
    else if (statusFilter === 'failed') {
      rows = rows.filter((r) => r.status === 'error' || r.status === 'aborted')
    }
    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.agent.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          (r.promptPreview || '').toLowerCase().includes(q) ||
          (r.batchId || '').toLowerCase().includes(q)
      )
    }
    return [...rows].sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1
      if (b.status === 'running' && a.status !== 'running') return 1
      return (b.startedAt || 0) - (a.startedAt || 0)
    })
  }, [scoped, statusFilter, query])

  const handleRerun = (run: SubagentRun): void => {
    const prompt = run.promptFull || run.promptPreview
    if (!prompt?.trim()) {
      showToast(t('subagents.rerunNoPrompt'))
      return
    }
    if (!activeSessionId) {
      showToast(t('subagents.rerunNoSession'))
      return
    }
    const handle = spawnBackgroundSubagent(
      {
        name: `${run.name}-rerun`.slice(0, 80),
        prompt,
        agent: run.agent,
        isolation: run.isolation,
        background: true
      },
      {
        projectId: run.projectId || activeProjectId || '__general__',
        sessionId: activeSessionId,
        projectPath
      }
    )
    showToast(t('subagents.rerunStarted', { id: handle.runId }))
    setExpanded(handle.runId)
  }

  const handleCopy = async (run: SubagentRun): Promise<void> => {
    const text =
      run.summary ||
      [
        `# ${run.name} [${run.agent}] — ${run.status}`,
        run.error || '',
        run.promptFull || run.promptPreview || ''
      ]
        .filter(Boolean)
        .join('\n')
    const ok = await copyText(text)
    showToast(ok ? t('subagents.copied') : t('subagents.copyFailed'))
  }

  return (
    <div className="subagents-view">
      <div className="subagents-header">
        <div className="subagents-title-row">
          <div className="subagents-title">
            <div className="subagents-title-icon" aria-hidden>
              ◆
            </div>
            <div>
              <h3>{t('subagents.title')}</h3>
              <span className="subagents-count">
                {stats.running > 0
                  ? t('subagents.runningCount', { count: stats.running })
                  : t('subagents.idle')}
              </span>
            </div>
          </div>
          <div className="subagents-actions">
            {activeSessionId && stats.running > 0 && (
              <button
                type="button"
                className="subagents-btn danger"
                onClick={() => cancelAllForSession(activeSessionId)}
              >
                {t('subagents.cancelAll')}
              </button>
            )}
            <button
              type="button"
              className="subagents-btn"
              onClick={() =>
                activeSessionId && scope === 'session'
                  ? clearFinishedForSession(activeSessionId)
                  : clearFinished()
              }
            >
              {t('subagents.clearDone')}
            </button>
          </div>
        </div>

        <div className="subagents-stats" aria-label={t('subagents.statsLabel')}>
          <div className="subagents-stat">
            <span className="subagents-stat-val running">{stats.running}</span>
            <span className="subagents-stat-label">{t('subagents.statRunning')}</span>
          </div>
          <div className="subagents-stat">
            <span className="subagents-stat-val ok">{stats.ok}</span>
            <span className="subagents-stat-label">{t('subagents.statDone')}</span>
          </div>
          <div className="subagents-stat">
            <span className="subagents-stat-val fail">{stats.failed}</span>
            <span className="subagents-stat-label">{t('subagents.statFailed')}</span>
          </div>
          <div className="subagents-stat subagents-stat-wide">
            <span className="subagents-stat-val cost">
              ${stats.cost.toFixed(3)}
              <span className="subagents-stat-cache">
                {' '}
                · {Math.round(stats.cacheHitRate * 100)}%
              </span>
            </span>
            <span className="subagents-stat-label">{t('subagents.statCost')}</span>
          </div>
        </div>

        <div className="subagents-toolbar">
          <div className="subagents-filter" role="tablist">
            <button
              type="button"
              className={scope === 'session' ? 'active' : ''}
              onClick={() => setScope('session')}
            >
              {t('subagents.thisSession')}
            </button>
            <button
              type="button"
              className={scope === 'all' ? 'active' : ''}
              onClick={() => setScope('all')}
            >
              {t('subagents.all')}
            </button>
          </div>
          <div className="subagents-filter status" role="tablist">
            {(
              [
                ['all', t('subagents.filterAll')],
                ['running', t('subagents.filterRunning')],
                ['done', t('subagents.filterDone')],
                ['failed', t('subagents.filterFailed')]
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={statusFilter === key ? 'active' : ''}
                onClick={() => setStatusFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <input
          className="subagents-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('subagents.searchPh')}
          aria-label={t('subagents.searchPh')}
        />
      </div>

      {toast && <div className="subagents-toast">{toast}</div>}

      {list.length === 0 ? (
        <div className="subagents-empty">
          <div className="subagents-empty-glyph" aria-hidden>
            ✦
          </div>
          <p className="subagents-empty-title">{t('subagents.emptyTitle')}</p>
          <p>{t('subagents.empty')}</p>
          <ul className="subagents-empty-tips">
            <li>{t('subagents.emptyTip1')}</li>
            <li>{t('subagents.emptyTip2')}</li>
            <li>{t('subagents.emptyTip3')}</li>
          </ul>
        </div>
      ) : (
        <ul className="subagents-list">
          {list.map((run) => {
            const open = expanded === run.id
            const sc = statusClass(run.status)
            const pct = progressPct(run)
            return (
              <li key={run.id} className={`subagents-card status-${sc}`}>
                {run.status === 'running' && (
                  <div
                    className="subagents-card-progress"
                    style={{ width: `${pct}%` }}
                  />
                )}
                <div className="subagents-card-main">
                  <button
                    type="button"
                    className="subagents-card-head"
                    onClick={() => setExpanded(open ? null : run.id)}
                    aria-expanded={open}
                  >
                    <span className={`subagents-dot ${sc}`} />
                    <span className="subagents-name">{run.name}</span>
                    <span className="subagents-agent">[{run.agent}]</span>
                    {run.background && <span className="subagents-bg">bg</span>}
                    {run.batchId && (
                      <span className="subagents-chip" title={run.batchId}>
                        batch
                      </span>
                    )}
                    {run.isolation === 'worktree' && (
                      <span className="subagents-chip">{t('subagents.chipWorktree')}</span>
                    )}
                    {run.applied && (
                      <span className="subagents-chip ok">{t('subagents.chipApplied')}</span>
                    )}
                    {run.applyPending && (
                      <span className="subagents-chip warn">{t('subagents.chipPendingApply')}</span>
                    )}
                    {run.applyConflicts && run.applyConflicts.length > 0 && (
                      <span className="subagents-chip warn">{t('subagents.chipConflicts')}</span>
                    )}
                    <span className="subagents-meta">
                      r{run.rounds}
                      {run.maxRounds ? `/${run.maxRounds}` : ''} · {elapsed(run, now)}
                      {run.lastTool && run.status === 'running' ? ` · ${run.lastTool}` : ''}
                      {run.usage && run.usage.calls > 0
                        ? ` · $${run.usage.cost.toFixed(3)} · cache ${Math.round(run.usage.cacheHitRate * 100)}%`
                        : ''}
                    </span>
                    <span className={`subagents-status-label ${sc}`}>{run.status}</span>
                  </button>
                  {run.status === 'running' && (
                    <button
                      type="button"
                      className="subagents-cancel"
                      onClick={() => cancel(run.id)}
                    >
                      {t('subagents.cancel')}
                    </button>
                  )}
                </div>
                {open && (
                  <div className="subagents-card-body">
                    <div className="subagents-card-actions-row">
                      <button
                        type="button"
                        className="subagents-mini-btn"
                        onClick={() => void handleCopy(run)}
                      >
                        {t('subagents.copy')}
                      </button>
                      {(run.promptFull || run.promptPreview) && (
                        <button
                          type="button"
                          className="subagents-mini-btn"
                          onClick={() => handleRerun(run)}
                        >
                          {t('subagents.rerun')}
                        </button>
                      )}
                      {run.applyPending && run.worktreePath && (
                        <>
                          <button
                            type="button"
                            className="subagents-mini-btn primary"
                            onClick={() => {
                              void applyPendingWorktree(run.id).then((r) =>
                                showToast(r.ok ? t('subagents.applyOk') : r.error || t('subagents.applyFail'))
                              )
                            }}
                          >
                            {t('subagents.applyChanges')}
                          </button>
                          <button
                            type="button"
                            className="subagents-mini-btn"
                            onClick={() => {
                              void discardPendingWorktree(run.id).then((r) =>
                                showToast(r.ok ? t('subagents.discardOk') : r.error || t('subagents.discardFail'))
                              )
                            }}
                          >
                            {t('subagents.discardChanges')}
                          </button>
                        </>
                      )}
                    </div>
                    <div className="subagents-id">id: {run.id}</div>
                    {run.batchId && (
                      <div className="subagents-id">batch: {run.batchId}</div>
                    )}
                    {(run.promptFull || run.promptPreview) && (
                      <div className="subagents-prompt">
                        {(run.promptFull || run.promptPreview || '').slice(0, 1200)}
                      </div>
                    )}
                    {run.status === 'running' && (
                      <div className="subagents-progress-bar" aria-hidden>
                        <div style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {run.usage && run.usage.calls > 0 && (
                      <div className="subagents-usage">
                        {t('subagents.usageLine', {
                          cost: run.usage.cost.toFixed(4),
                          hit: Math.round(run.usage.cacheHitRate * 100),
                          model: run.usage.modelLabel || '—',
                          calls: run.usage.calls
                        })}
                      </div>
                    )}
                    {run.toolsUsed.length > 0 && (
                      <div className="subagents-tools">
                        <span className="subagents-body-label">{t('subagents.tools')}</span>
                        {[...new Set(run.toolsUsed)].join(', ')}
                      </div>
                    )}
                    {run.filesChanged && run.filesChanged.length > 0 && (
                      <div className="subagents-files">
                        <span className="subagents-body-label">{t('subagents.files')}</span>
                        {run.filesChanged.slice(0, 24).join(', ')}
                      </div>
                    )}
                    {run.applyConflicts && run.applyConflicts.length > 0 && (
                      <div className="subagents-conflicts">
                        <span className="subagents-body-label">{t('subagents.conflicts')}</span>
                        {run.applyConflicts.slice(0, 16).join(', ')}
                      </div>
                    )}
                    {run.error && <div className="subagents-error">{run.error}</div>}
                    {run.summary && (
                      <pre className="subagents-summary">{run.summary.slice(0, 6000)}</pre>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
