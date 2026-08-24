import { useTranslation } from 'react-i18next'
import { formatCombo } from '../stores/keybindings'
import Tooltip from './Tooltip'
import './NavControls.css'

interface NavControlsProps {
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
}

/** ChatGPT-style back/forward pair for traversing session/view history. */
export default function NavControls({ canGoBack, canGoForward, onBack, onForward }: NavControlsProps): React.JSX.Element {
  const { t } = useTranslation()
  const backShortcut = formatCombo('Meta+[')
  const forwardShortcut = formatCombo('Meta+]')

  return (
    <div className="nav-controls">
      <Tooltip label={t('contextBar.navBack')} shortcut={backShortcut} placement="bottom" disabled={!canGoBack}>
        <button
          className="nav-btn"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label={t('contextBar.navBack')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label={t('contextBar.navForward')} shortcut={forwardShortcut} placement="bottom" disabled={!canGoForward}>
        <button
          className="nav-btn"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label={t('contextBar.navForward')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}
