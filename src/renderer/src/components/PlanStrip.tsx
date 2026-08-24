import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlanStore, type PlanItemStatus } from '../stores/plan'
import './PlanStrip.css'

export default function PlanStrip({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const { t } = useTranslation()
  const items = usePlanStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) || []
  const [collapsed, setCollapsed] = useState(false)

  if (!sessionId || items.length === 0) return null

  const done = items.filter((i) => i.status === 'done' || i.status === 'cancelled').length
  const inProgress = items.filter((i) => i.status === 'in_progress').length
  const allDone = done === items.length
  const progressPercent = items.length > 0 ? Math.round((done / items.length) * 100) : 0

  return (
    <div className={`plan-strip ${allDone ? 'plan-strip-done' : ''}`}>
      <div className="plan-strip-header">
        <button
          type="button"
          className="plan-strip-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          <span className="plan-strip-icon-badge">
            {allDone ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : inProgress > 0 ? (
              <span className="plan-strip-pulse" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              </svg>
            )}
          </span>
          <span className="plan-strip-title">{t('plan.title')}</span>
          <span className="plan-strip-progress">
            {done}/{items.length} ({progressPercent}%)
          </span>
          <div className="plan-strip-bar-track">
            <div className="plan-strip-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <svg
            className={`plan-strip-chevron ${collapsed ? 'collapsed' : ''}`}
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button
          type="button"
          className="plan-strip-clear"
          onClick={() => usePlanStore.getState().clearPlan(sessionId)}
          title={t('plan.clear')}
          aria-label={t('plan.clear')}
        >
          ×
        </button>
      </div>
      {!collapsed && (
        <ul className="plan-strip-list">
          {items.map((item) => (
            <li key={item.id} className={`plan-item plan-item-${item.status}`}>
              <span className="plan-item-status-icon" aria-hidden>
                {item.status === 'done' ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : item.status === 'in_progress' ? (
                  <span className="plan-item-spinner" />
                ) : item.status === 'cancelled' ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                ) : (
                  <span className="plan-item-dot" />
                )}
              </span>
              <span className="plan-item-text">{item.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
