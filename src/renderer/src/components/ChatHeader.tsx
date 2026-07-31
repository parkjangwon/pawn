import { useTranslation } from 'react-i18next'

interface ChatHeaderProps {
  onToggleSidebar: () => void
}

export default function ChatHeader({ onToggleSidebar }: ChatHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
      <div className="chat-header">
        <button className="sidebar-toggle-btn close-sidebar-btn" onClick={onToggleSidebar} aria-label={t('contextBar.openSidebar')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        <div className="chat-header-spacer" />
        <button className="sidebar-toggle-btn right-panel-toggle" onClick={() => (window as any).__toggleRightPanel?.()} aria-label={t('contextBar.toggleRightPanel')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      </div>
  )
}
