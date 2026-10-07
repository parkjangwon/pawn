import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ClipboardList, X } from 'lucide-react'
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
              <Check size={12} />
            ) : inProgress > 0 ? (
              <span className="plan-strip-pulse" />
            ) : (
              <ClipboardList size={12} />
            )}
          </span>
          <span className="plan-strip-title">{t('plan.title')}</span>
          <span className="plan-strip-progress">
            {done}/{items.length} ({progressPercent}%)
          </span>
          <div className="plan-strip-bar-track">
            <div className="plan-strip-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <ChevronDown
            size={10}
            className={`plan-strip-chevron ${collapsed ? 'collapsed' : ''}`}
          />
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
                  <Check size={11} />
                ) : item.status === 'in_progress' ? (
                  <span className="plan-item-spinner" />
                ) : item.status === 'cancelled' ? (
                  <X size={11} />
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
