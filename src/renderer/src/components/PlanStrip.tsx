import { useTranslation } from 'react-i18next'
import { usePlanStore, type PlanItemStatus } from '../stores/plan'
import './PlanStrip.css'

const STATUS_ICON: Record<PlanItemStatus, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
  cancelled: '✕'
}

export default function PlanStrip({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const { t } = useTranslation()
  const items = usePlanStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) || []
  if (!sessionId || items.length === 0) return null

  const done = items.filter((i) => i.status === 'done' || i.status === 'cancelled').length
  const allDone = done === items.length

  return (
    <div className={`plan-strip ${allDone ? 'plan-strip-done' : ''}`}>
      <div className="plan-strip-header">
        <span className="plan-strip-title">{t('plan.title')}</span>
        <span className="plan-strip-progress">
          {done}/{items.length}
        </span>
        <button
          type="button"
          className="plan-strip-clear"
          onClick={() => usePlanStore.getState().clearPlan(sessionId)}
          title={t('plan.clear')}
        >
          ×
        </button>
      </div>
      <ul className="plan-strip-list">
        {items.map((item) => (
          <li key={item.id} className={`plan-item plan-item-${item.status}`}>
            <span className="plan-item-icon" aria-hidden>
              {STATUS_ICON[item.status]}
            </span>
            <span className="plan-item-text">{item.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
