import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
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
        <span className="sidebar-title">hjcode Desktop</span>
      </div>

      <button className="new-session-btn" onClick={handleAddProject}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
        {t('sidebar.addProject')}
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}
