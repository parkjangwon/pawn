import { useTranslation } from 'react-i18next'
import { openSettingsSection } from './settingsState'
import type { MessageErrorInfo } from '../stores/app'
import './ErrorCard.css'

const TITLE_KEYS: Record<MessageErrorInfo['kind'], string> = {
  auth: 'chat.errorCard.titleAuth',
  rate: 'chat.errorCard.titleRate',
  server: 'chat.errorCard.titleServer',
  network: 'chat.errorCard.titleNetwork',
  generic: 'chat.errorCard.titleGeneric'
}

const HINT_KEYS: Record<MessageErrorInfo['kind'], string> = {
  auth: 'chat.errorCard.hintAuth',
  rate: 'chat.errorCard.hintRate',
  server: 'chat.errorCard.hintServer',
  network: 'chat.errorCard.hintNetwork',
  generic: 'chat.errorCard.hintGeneric'
}

interface ErrorCardProps {
  error: MessageErrorInfo
  /** Re-run the failed turn (same flow as Regenerate on an assistant row). */
  onRetry?: () => void
}

/** Actionable failure card for a collapsed agent turn: what broke, what to
 *  do next, the raw detail on demand, and one-click recovery. */
export default function ErrorCard({ error, onRetry }: ErrorCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="error-card" role="alert">
      <div className="error-card-head">
        <svg
          className="error-card-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="error-card-copy">
          <div className="error-card-title">{t(TITLE_KEYS[error.kind])}</div>
          <div className="error-card-hint">{t(HINT_KEYS[error.kind])}</div>
        </div>
      </div>
      {error.detail ? (
        <details className="error-card-details">
          <summary>{t('chat.errorCard.details')}</summary>
          <pre>{error.detail}</pre>
        </details>
      ) : null}
      <div className="error-card-actions">
        {onRetry && (
          <button type="button" className="error-card-btn primary" onClick={onRetry}>
            {t('chat.errorCard.retry')}
          </button>
        )}
        {error.settingsTarget && (
          <button
            type="button"
            className="error-card-btn"
            onClick={() => openSettingsSection(error.settingsTarget)}
          >
            {t('chat.errorCard.settings')}
          </button>
        )}
      </div>
    </div>
  )
}
