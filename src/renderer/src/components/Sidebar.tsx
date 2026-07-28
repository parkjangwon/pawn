import { useState } from 'react'
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
    removeProject,
    setActiveProject,
    addSession,
    removeSession,
    setActiveSession,
    updateSessionTitle,
    updateProjectName
  } = useAppStore()

  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleAddProject = async (): Promise<void> => {
    const folder = await window.api.selectFolder()
    if (!folder) return
    const name = folder.split('/').pop() || folder.split('\\').pop() || folder
    addProject(name, folder)
  }

  const handleDeleteProject = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    removeProject(id)
  }

  const handleDeleteSession = (e: React.MouseEvent, projectId: string, sessionId: string): void => {
    e.stopPropagation()
    removeSession(projectId, sessionId)
  }

  const startRenameSession = (e: React.MouseEvent, sessionId: string, currentTitle: string): void => {
    e.stopPropagation()
    setRenamingSession(sessionId)
    setRenameValue(currentTitle)
  }

  const commitRenameSession = (projectId: string, sessionId: string): void => {
    if (renameValue.trim()) {
      updateSessionTitle(projectId, sessionId, renameValue.trim())
    }
    setRenamingSession(null)
  }

  const startRenameProject = (e: React.MouseEvent, projectId: string, currentName: string): void => {
    e.stopPropagation()
    setRenamingProject(projectId)
    setRenameValue(currentName)
  }

  const commitRenameProject = (projectId: string): void => {
    if (renameValue.trim()) {
      updateProjectName(projectId, renameValue.trim())
    }
    setRenamingProject(null)
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
            <div key={p.id} className={`project-tab-wrapper ${p.id === activeProjectId ? 'active' : ''}`}>
              {renamingProject === p.id ? (
                <input
                  className="rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRenameProject(p.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRenameProject(p.id); if (e.key === 'Escape') setRenamingProject(null) }}
                  autoFocus
                />
              ) : (
                <button
                  className="project-tab"
                  onClick={() => setActiveProject(p.id)}
                  onDoubleClick={(e) => startRenameProject(e, p.id, p.name)}
                  title={p.path}
                >
                  {p.name}
                </button>
              )}
              <button className="tab-delete-btn" onClick={(e) => handleDeleteProject(e, p.id)} title="Delete project">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
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
            {renamingSession === session.id ? (
              <input
                className="rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRenameSession(activeProject.id, session.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRenameSession(activeProject.id, session.id); if (e.key === 'Escape') setRenamingSession(null) }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="session-title"
                onDoubleClick={(e) => startRenameSession(e, session.id, session.title)}
              >
                {session.title}
              </span>
            )}
            <button
              className="session-delete-btn"
              onClick={(e) => handleDeleteSession(e, activeProject.id, session.id)}
              title="Delete session"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
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
