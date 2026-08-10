import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useSubagentRunsStore, type SubagentRun } from '../stores/subagentRuns'
import './SubagentActivity.css'

/** How long a finished batch stays visible as "done" before disappearing. */
const RECENT_DONE_MS = 15_000

function statusClass(status: SubagentRun['status']): string {
  if (status === 'running') return 'running'
  if (status === 'ok') return 'ok'
  if (status === 'aborted') return 'aborted'
  return 'error'
}

function elapsed(run: SubagentRun, now: number): string {
  const end = run.finishedAt || now
  const sec = Math.max(0, Math.round((end - run.startedAt) / 1000))
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

/**
 * Inline live status for the current chat's subagents: a slim collapsible bar
 * ("N helpers working…") that expands to show what each run is doing. It
 * appears only while helpers for this session are running (or just finished)
 * and replaces the old "auto-open the Agents panel" behavior — the panel tab
 * stays for history review.
 */
export default function SubagentActivity({
  sessionId
}: {
  sessionId?: string | null
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const enabled = useProviderStore((s) => s.autoOpenAgentsPanel)
  const runs = useSubagentRunsStore((s) => s.runs)
  const cancel = useSubagentRunsStore((s) => s.cancel)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const scoped = sessionId ? runs.filter((r) => r.parentSessionId === sessionId) : []

  const live = scoped.some((r) => r.status === 'running')
  const recent = scoped.some(
    (r) => r.status !== 'running' && r.finishedAt != null && now - r.finishedAt < RECENT_DONE_MS
  )

  useEffect(() => {
    if (!live && !recent) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [live, recent])

  if (!enabled || !sessionId || (!live && !recent) || scoped.length === 0) return null

  const runningCount = scoped.filter((r) => r.status === 'running').length
  const doneCount = scoped.length - runningCount

  return (
    <div className={`subagent-activity${open ? ' open' : ''}`}>
      <button
        type="button"
        className="subagent-activity-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="subagent-activity-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="subagent-activity-dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="subagent-activity-title">
          {live
            ? t('subagents.inlineWorking', { count: runningCount })
            : t('subagents.inlineDone')}
        </span>
        {live && doneCount > 0 && (
          <span className="subagent-activity-sub">
            · {t('subagents.inlineDoneCount', { count: doneCount })}
          </span>
        )}
      </button>
      {open && (
        <ul className="subagent-activity-list">
          {scoped.map((run) => {
            const sc = statusClass(run.status)
            return (
              <li key={run.id} className={`subagent-activity-row status-${sc}`}>
                <span className={`subagent-activity-dot ${sc}`} />
                <span className="subagent-activity-name">{run.name}</span>
                <span className="subagent-activity-agent">[{run.agent}]</span>
                <span className="subagent-activity-meta">
                  r{run.rounds}
                  {run.maxRounds ? `/${run.maxRounds}` : ''} · {elapsed(run, now)}
                  {run.lastTool && run.status === 'running' ? ` · ${run.lastTool}` : ''}
                </span>
                <span className={`subagent-activity-status ${sc}`}>{run.status}</span>
                {run.status === 'running' && (
                  <button
                    type="button"
                    className="subagent-activity-stop"
                    onClick={() => cancel(run.id)}
                    title={t('subagents.cancel')}
                    aria-label={t('subagents.cancel')}
                  >
                    ×
                  </button>
                )}
                {run.promptPreview && (
                  <span className="subagent-activity-prompt">{run.promptPreview}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
