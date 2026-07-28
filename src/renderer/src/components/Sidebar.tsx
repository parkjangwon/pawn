import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useThemeStore } from '../stores/theme'
import './Sidebar.css'

interface SidebarProps {
  onOpenSettings: () => void
}

export default function Sidebar({ onOpenSettings }: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  const {
    projects,
    activeProjectId,
    activeSessionId,
    addProject,
    setActiveProject,
    addSession,
    setActiveSession
  } = useAppStore()
  const { theme, toggle } = useThemeStore()

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleAddProject = async (): Promise<void> => {
    const folder = await window.api.selectFolder()
    if (!folder) return
    const name = folder.split('/').pop() || folder.split('\\').pop() || folder
    addProject(name, folder)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{t('app.name')}</span>
        <button className="icon-btn" onClick={toggle} title={t('settings.theme')}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      <button className="new-session-btn" onClick={handleAddProject}>
        📁 {t('sidebar.addProject')}
      </button>

      {projects.length > 0 && (
        <div className="project-tabs">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`project-tab ${p.id === activeProjectId ? 'active' : ''}`}
              onClick={() => setActiveProject(p.id)}
              title={p.path}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {activeProject && (
        <button
          className="new-session-btn secondary"
          onClick={() => addSession(activeProject.id)}
        >
          + {t('sidebar.newSession')}
        </button>
      )}

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
          <div className="empty-hint">{t('sidebar.sessions')}</div>
        )}
        {projects.length === 0 && (
          <div className="empty-hint">{t('sidebar.noProjects')}</div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="footer-btn" onClick={onOpenSettings}>
          ⚙️ {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}
