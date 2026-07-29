import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import FileBrowser from './FileBrowser'
import './Sidebar.css'

interface SidebarProps {
  onOpenSettings: () => void
  open?: boolean
}

const GENERAL_PROJECT_ID = '__general__'

export default function Sidebar({ onOpenSettings, open }: SidebarProps): React.JSX.Element {
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

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renamingProject, setRenamingProject] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(new Set())

  // Ensure general project exists
  const ensureGeneral = (): string => {
    const existing = projects.find((p) => p.id === GENERAL_PROJECT_ID)
    if (existing) return GENERAL_PROJECT_ID
    addProject('General', '')
    // The addProject sets activeProjectId, but we need to return the ID
    // Since addProject generates the ID internally, we use a known ID
    // Actually let's just use the GENERAL_PROJECT_ID directly
    return GENERAL_PROJECT_ID
  }

  const handleNewSession = (): void => {
    const targetProjectId = activeProjectId || ensureGeneral()
    addSession(targetProjectId)
  }

  const toggleProject = (id: string): void => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setActiveProject(id)
  }

  const handleAddProject = (): void => {
    setShowFileBrowser(true)
  }

  const handleProjectFolderSelected = (path: string): void => {
    const name = path.split('/').pop() || path.split('\\').pop() || path
    addProject(name, path)
    setShowFileBrowser(false)
  }

  const handleDeleteProject = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    if (id === GENERAL_PROJECT_ID) return
    removeProject(id)
  }

  const handleDeleteSession = (e: React.MouseEvent, projectId: string, sessionId: string): void => {
    e.stopPropagation()
    removeSession(projectId, sessionId)
  }

  const togglePin = (e: React.MouseEvent, sessionId: string): void => {
    e.stopPropagation()
    setPinnedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const startRenameSession = (e: React.MouseEvent, sessionId: string, currentTitle: string): void => {
    e.stopPropagation()
    setRenamingSession(sessionId)
    setRenameValue(currentTitle)
  }

  const commitRenameSession = (projectId: string, sessionId: string): void => {
    if (renameValue.trim()) updateSessionTitle(projectId, sessionId, renameValue.trim())
    setRenamingSession(null)
  }

  const startRenameProject = (e: React.MouseEvent, projectId: string, currentName: string): void => {
    e.stopPropagation()
    setRenamingProject(projectId)
    setRenameValue(currentName)
  }

  const commitRenameProject = (projectId: string): void => {
    if (renameValue.trim()) updateProjectName(projectId, renameValue.trim())
    setRenamingProject(null)
  }

  // Pinned sessions across all projects
  const pinnedItems = projects.flatMap((p) =>
    p.sessions.filter((s) => pinnedSessions.has(s.id)).map((s) => ({ ...s, projectId: p.id }))
  )

  // User-created projects (exclude general)
  const userProjects = projects.filter((p) => p.id !== GENERAL_PROJECT_ID)

  // Recent sessions (not pinned, sorted by creation)
  const recentSessions = projects.flatMap((p) =>
    p.sessions.filter((s) => !pinnedSessions.has(s.id)).map((s) => ({ ...s, projectId: p.id }))
  ).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8)

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-title">Pawn</span>
      </div>

      {/* Primary action: New Session */}
      <div className="sidebar-actions">
        <button className="sidebar-action-btn primary" onClick={handleNewSession}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          <span>New Session</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        {/* 1. Pinned */}
        {pinnedItems.length > 0 && (
          <div className="sidebar-section">
            <div className="section-label">Pinned</div>
            {pinnedItems.map((session) => (
              <div key={session.id} className={`sidebar-item ${session.id === activeSessionId ? 'active' : ''}`} onClick={() => { setActiveSession(session.id); setActiveProject(session.projectId) }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>
                <span className="item-title">{session.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* 2. Projects */}
        <div className="sidebar-section">
          <div className="section-header">
            <span className="section-label">Projects</span>
            <button className="section-add-btn" onClick={handleAddProject} title="Add project">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          </div>
          {userProjects.map((project) => {
            const isExpanded = expandedProjects.has(project.id) || project.id === activeProjectId
            return (
              <div key={project.id} className="tree-project">
                <div className={`tree-project-header ${project.id === activeProjectId ? 'active' : ''}`} onClick={() => toggleProject(project.id)}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}><polyline points="9 18 15 12 9 6" /></svg>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tree-folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  {renamingProject === project.id ? (
                    <input className="rename-input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => commitRenameProject(project.id)} onKeyDown={(e) => { if (e.key === 'Enter') commitRenameProject(project.id); if (e.key === 'Escape') setRenamingProject(null) }} autoFocus onClick={(e) => e.stopPropagation()} />
                  ) : (
                    <span className="tree-project-name" onDoubleClick={(e) => startRenameProject(e, project.id, project.name)}>{project.name}</span>
                  )}
                  <div className="tree-project-actions">
                    <button className="tree-action-btn" onClick={(e) => { e.stopPropagation(); addSession(project.id); if (!isExpanded) toggleProject(project.id) }} title="New session">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                    <button className="tree-action-btn delete" onClick={(e) => handleDeleteProject(e, project.id)} title="Delete">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="tree-sessions">
                    {project.sessions.map((session) => (
                      <div key={session.id} className={`tree-session ${session.id === activeSessionId ? 'active' : ''}`} onClick={() => { setActiveSession(session.id); setActiveProject(project.id) }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                        {renamingSession === session.id ? (
                          <input className="rename-input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => commitRenameSession(project.id, session.id)} onKeyDown={(e) => { if (e.key === 'Enter') commitRenameSession(project.id, session.id); if (e.key === 'Escape') setRenamingSession(null) }} autoFocus onClick={(e) => e.stopPropagation()} />
                        ) : (
                          <span className="tree-session-title" onDoubleClick={(e) => startRenameSession(e, session.id, session.title)}>{session.title}</span>
                        )}
                        <div className="tree-session-actions">
                          <button className="tree-action-btn pin" onClick={(e) => togglePin(e, session.id)} title={pinnedSessions.has(session.id) ? 'Unpin' : 'Pin'}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill={pinnedSessions.has(session.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>
                          </button>
                          <button className="tree-action-btn delete" onClick={(e) => handleDeleteSession(e, project.id, session.id)} title="Delete">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                    {project.sessions.length === 0 && <div className="tree-empty">No sessions</div>}
                  </div>
                )}
              </div>
            )
          })}
          {userProjects.length === 0 && <div className="empty-hint">No projects yet</div>}
        </div>

        {/* 3. Recent */}
        {recentSessions.length > 0 && (
          <div className="sidebar-section">
            <div className="section-label">Recent</div>
            {recentSessions.map((session) => (
              <div key={session.id} className={`sidebar-item ${session.id === activeSessionId ? 'active' : ''}`} onClick={() => { setActiveSession(session.id); setActiveProject(session.projectId) }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                <span className="item-title">{session.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button className="footer-btn" onClick={onOpenSettings}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>{t('sidebar.settings')}</span>
        </button>
      </div>

      {showFileBrowser && (
        <FileBrowser initialPath="/" onSelect={handleProjectFolderSelected} onClose={() => setShowFileBrowser(false)} />
      )}
    </aside>
  )
}
