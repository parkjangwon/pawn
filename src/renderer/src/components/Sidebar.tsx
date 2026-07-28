import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useThemeStore } from '../stores/theme'
import './Sidebar.css'

export default function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const { projects, activeProjectId, activeSessionId, addSession, setActiveSession } =
    useAppStore()
  const { theme, toggle } = useThemeStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{t('app.name')}</span>
        <button className="icon-btn" onClick={toggle} title={t('settings.theme')}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      <button className="new-session-btn" onClick={() => activeProject && addSession(activeProject.id)}>
        + {t('sidebar.newSession')}
      </button>

      <div className="session-list">
        {activeProject?.sessions.map((session) => (
          <div
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => setActiveSession(session.id)}
          >
            <span className="session-icon">💬</span>
            <span className="session-title">{session.title}</span>
          </div>
        ))}
        {activeProject && activeProject.sessions.length === 0 && (
          <div className="empty-hint">{t('sidebar.noProjects')}</div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="footer-btn">⚙️ {t('sidebar.settings')}</button>
      </div>
    </aside>
  )
}
