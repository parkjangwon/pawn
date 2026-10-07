import { useEffect, useState } from 'react'
import { tx } from '../i18n'
import { X, Zap } from 'lucide-react'
import { useChatStore } from '../stores/chat'
import { useUltraWorkStore, ultraWorkSpend } from '../stores/ultraWork'
import { formatUltraDuration } from '../agent/ultraWork'
import { formatCost, formatTokens } from '../stores/usage'
import './UltraWork.css'

/**
 * Live status for an Ultra Work run: rainbow-ringed strip above the composer
 * with goal, iteration, elapsed time, spend, and the evaluator's last verdict.
 */
export default function UltraWorkBanner({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const run = useUltraWorkStore((s) => (sessionId ? s.runs[sessionId] : undefined))
  const stop = useUltraWorkStore((s) => s.stop)
  const dismiss = useUltraWorkStore((s) => s.dismiss)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const [now, setNow] = useState(Date.now())
  const active = run?.status === 'active'

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])

  if (!run || !sessionId) return null
  const elapsed = (run.endedAt ?? now) - run.startedAt
  const spend = ultraWorkSpend(run)
  const statusLabel = tx(`ultraWork.status.${run.status}`)

  return (
    <div
      className={`ulw-banner ulw-${run.status}`}
      role="status"
      aria-live="polite"
      aria-label={`${'Ultra Work'}: ${statusLabel}`}
    >
      <div className="ulw-banner-inner">
        <div className="ulw-row">
          <span className="ulw-wordmark" aria-hidden>
            <Zap size={12} className="ulw-bolt" />
            <span className="ulw-rainbow-text">{'ULTRA WORK'}</span>
          </span>
          <span className={`ulw-status ulw-status-${run.status}`}>
            {active && <span className="ulw-pulse" aria-hidden />}
            {statusLabel}
          </span>
          <span className="ulw-meta">
            <span title={'Each iteration is one full agent answer; a fast model checks the goal after each one'}>
              {`Iteration ${run.iteration}/${run.maxIterations}`}
            </span>
            <span aria-hidden>·</span>
            <span className="ulw-num">{formatUltraDuration(elapsed)}</span>
            {spend.tokens > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="ulw-num">{formatTokens(spend.tokens)} tok</span>
              </>
            )}
            {spend.cost > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="ulw-num">{formatCost(spend.cost)}</span>
              </>
            )}
          </span>
          {active ? (
            <button
              type="button"
              className="ulw-btn"
              onClick={() => {
                stop(sessionId)
                stopStreaming(sessionId)
              }}
            >
              {'Stop'}
            </button>
          ) : (
            <button type="button" className="ulw-btn ghost" onClick={() => dismiss(sessionId)} aria-label={'Dismiss'}>
              <X size={12} aria-hidden />
            </button>
          )}
        </div>
        <div className="ulw-goal" title={run.goal}>
          <span className="ulw-goal-label">{'Goal'}</span>
          <span className="ulw-goal-text">{run.goal}</span>
        </div>
        {run.lastReason && (
          <div className="ulw-reason">
            <span className="ulw-goal-label">{run.status === 'active' ? 'Next' : 'Result'}</span>
            <span>{run.lastReason}</span>
          </div>
        )}
        <div className="ulw-progress" aria-hidden>
          <span style={{ width: `${Math.min(100, (run.iteration / run.maxIterations) * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}
