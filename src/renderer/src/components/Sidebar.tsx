import { useState, useEffect, useMemo } from 'react'
import { tx } from '../i18n'
import { ChevronRight, Folder, History, MessageSquare, Pencil, Plus, Search, Settings, Star, X } from 'lucide-react'
import { useAppStore } from '../stores/app'
import { IconChevronRight } from './icons'
import { useChatStore } from '../stores/chat'
import { useRoutineStore } from '../stores/routine'
import { useQuestionStore } from '../stores/userQuestions'
import { useUltraWorkStore } from '../stores/ultraWork'
import './UltraWork.css'
import { usePermissionStore } from '../stores/permission'
import './QuestionCard.css'
import { useKeybindingsStore, formatCombo } from '../stores/keybindings'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { activateOnKey } from '../utils/focusTrap'
import ProjectEditDialog from './ProjectEditDialog'
import ConfirmDialog from './ConfirmDialog'
import Tooltip from './Tooltip'
import './Sidebar.css'

interface SidebarProps {
  onOpenSettings: () => void
  onOpenCommandPalette?: () => void
  onToggle: () => void
  open?: boolean
  mainView: 'chat' | 'automations'
  onMainViewChange: (view: 'chat' | 'automations') => void
  onSidebarWidthChange: (width: number) => void
}

const GENERAL_PROJECT_ID = '__general__'

export default function Sidebar({ onOpenSettings, onOpenCommandPalette, onToggle, open, mainView, onMainViewChange, onSidebarWidthChange }: SidebarProps): React.JSX.Element {
  const {
    projects,
    activeProjectId,
    activeSessionId,
    addProject,
    removeProject,
    setActiveProject,
    addSession,
    openNewChat,
    removeSession,
    archiveSession,
    unarchiveSession,
    deleteArchivedSession,
    archivedSessions,
    setActiveSession,
    updateSessionTitle,
    updateProjectName
  } = useAppStore()
  const streamingSessionIds = useChatStore((s) => s.streamingSessionIds)
  const runningRoutineIds = useRoutineStore((s) => s.runningIds)
  // Sessions blocked on the user: an agent question or a permission prompt.
  const waitingQuestionSessions = useQuestionStore((s) => s.pending.map((q) => q.sessionId).join('|'))
  const waitingPermissionSessions = usePermissionStore((s) =>
    s.pending.map((p) => p.sessionId || '').join('|')
  )
  const ultraSessions = useUltraWorkStore((s) =>
    Object.values(s.runs).filter((r) => r.status === 'active').map((r) => r.sessionId).join('|')
  )
  const waitingSessions = useMemo(
    () => new Set([...waitingQuestionSessions.split('|'), ...waitingPermissionSessions.split('|')].filter(Boolean)),
    [waitingQuestionSessions, waitingPermissionSessions]
  )
  const keybindings = useKeybindingsStore((s) => s.bindings)
  const initialized = useAppStore((s) => s.initialized)

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [recentExpanded, setRecentExpanded] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | undefined>(undefined)
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(new Set())
  const [renamingSession, setRenamingSession] = useState<{ projectId: string; sessionId: string; title: string } | null>(null)
  useEffect(() => { try { const s = localStorage.getItem('pawn-pinned-sessions'); if (s) setPinnedSessions(new Set(JSON.parse(s))) } catch {} }, [])

  // Shared with the Settings nav: same width, same localStorage key, and the
  // width is committed through App so both stay in sync.
  const attachResizer = useSidebarResize(onSidebarWidthChange)

  // Surface live info for recent sessions that only exist in the DB so far;
  // counts/previews then update as soon as the store has their history.
  useEffect(() => {
    if (!initialized) return
    const { projects, loadedSessions, loadMessages } = useAppStore.getState()
    const candidates = projects
      .flatMap((p) => p.sessions.map((s) => ({ session: s, projectId: p.id })))
      .sort((a, b) => b.session.createdAt - a.session.createdAt)
      .slice(0, 8)
    for (const { session, projectId } of candidates) {
      if (!loadedSessions.has(session.id)) void loadMessages(projectId, session.id)
    }
  }, [initialized])
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'project' | 'session' | 'archivedSession'; id: string; projectId?: string; name: string } | null>(null)

  // New chat stays in the project on screen (General when none) — the composer
  // chip switches project or "Work without project" before the first send.
  // The + on a project row starts a chat in that specific project.
  const handleNewSession = (): void => {
    onMainViewChange('chat')
    openNewChat()
  }

  const toggleProject = (id: string): void => {
    onMainViewChange('chat')
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setActiveProject(id)
  }

  const handleAddProject = (): void => {
    setEditingProjectId(undefined)
    setShowProjectDialog(true)
  }
  // Welcome checklist "Add a folder" and other entry points.
  useEffect(() => {
    const onAdd = (): void => handleAddProject()
    window.addEventListener('pawn:add-project', onAdd)
    return () => window.removeEventListener('pawn:add-project', onAdd)
  }, [])

  const handleEditProject = (e: React.MouseEvent, projectId: string): void => {
    e.stopPropagation()
    setEditingProjectId(projectId)
    setShowProjectDialog(true)
  }

  const handleDeleteProject = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    if (id === GENERAL_PROJECT_ID) return
    const project = projects.find((p) => p.id === id)
    setConfirmDelete({ type: 'project', id, name: project?.name || 'Project' })
  }

  const handleDeleteSession = (e: React.MouseEvent, projectId: string, sessionId: string): void => {
    e.stopPropagation()
    const session = projects.find((p) => p.id === projectId)?.sessions.find((s) => s.id === sessionId)
    setConfirmDelete({ type: 'session', id: sessionId, projectId, name: session?.title || 'Chat' })
  }

  // Soft-delete: out of every list, restorable from the archive section.
  // Streaming is deliberately left running — archiving is bookkeeping, not abort.
  const handleArchiveSession = (e: React.MouseEvent, projectId: string, sessionId: string): void => {
    e.stopPropagation()
    archiveSession(projectId, sessionId)
    setPinnedSessions((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      try { localStorage.setItem('pawn-pinned-sessions', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  // Restore puts the chat back in its project without yanking the view;
  // clicking the row restores and opens it.
  const handleRestoreSession = (sessionId: string, open: boolean): void => {
    const info = archivedSessions.find((a) => a.id === sessionId)
    unarchiveSession(sessionId)
    if (open && info) {
      onMainViewChange('chat')
      setActiveProject(info.projectId)
      setActiveSession(sessionId)
    }
  }

  const handleDeleteArchivedSession = (sessionId: string): void => {
    const info = archivedSessions.find((a) => a.id === sessionId)
    setConfirmDelete({ type: 'archivedSession', id: sessionId, name: info?.title || 'Chat' })
  }

  const handleConfirmDelete = (): void => {
    if (!confirmDelete) return
    // A deleted session/project can no longer receive the turn's tool
    // results — abort it first so the agent loop doesn't keep streaming
    // into a session that's already gone from the store.
    const { streamingSessionIds, stopStreaming } = useChatStore.getState()
    if (confirmDelete.type === 'project') {
      const project = projects.find((p) => p.id === confirmDelete.id)
      for (const sid of streamingSessionIds) {
        if (project?.sessions.some((s) => s.id === sid)) stopStreaming(sid)
      }
      removeProject(confirmDelete.id)
    } else if (confirmDelete.type === 'session' && confirmDelete.projectId) {
      if (streamingSessionIds.includes(confirmDelete.id)) stopStreaming(confirmDelete.id)
      removeSession(confirmDelete.projectId, confirmDelete.id)
      // Drop it from the pinned set too, so a stale id doesn't linger in
      // localStorage once its session no longer exists.
      setPinnedSessions((prev) => {
        if (!prev.has(confirmDelete.id)) return prev
        const next = new Set(prev)
        next.delete(confirmDelete.id)
        try { localStorage.setItem('pawn-pinned-sessions', JSON.stringify([...next])) } catch {}
        return next
      })
    } else if (confirmDelete.type === 'archivedSession') {
      if (streamingSessionIds.includes(confirmDelete.id)) stopStreaming(confirmDelete.id)
      deleteArchivedSession(confirmDelete.id)
    }
    setConfirmDelete(null)
  }

  const togglePin = (e: React.MouseEvent, sessionId: string): void => {
    e.stopPropagation()
    setPinnedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      try { localStorage.setItem('pawn-pinned-sessions', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  // Shared archive row-action (soft delete). Hover target like pin/delete.
  const renderArchiveButton = (projectId: string, sessionId: string): React.ReactNode => (
    <button
      type="button"
      className="tree-action-btn"
      onClick={(e) => handleArchiveSession(e, projectId, sessionId)}
      title={'Archive'}
      aria-label={'Archive'}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
    </button>
  )

  // Pinned sessions across all projects
  const pinnedItems = projects.flatMap((p) =>
    p.sessions
      .filter((s) => pinnedSessions.has(s.id))
      .map((s) => ({ ...s, projectId: p.id }))
  )

  // User-created projects (exclude general)
  const userProjects = projects.filter((p) => p.id !== GENERAL_PROJECT_ID)

  const sessionMeta = (session: { id: string; messages: Array<{ role: string; content: string; createdAt: number }>; createdAt: number }): {
    preview: string
    lastActivity: number
    running: boolean
    waiting: boolean
    ultra: boolean
  } => {
    const last = session.messages[session.messages.length - 1]
    const firstLine = (last?.content || '').split('\n').find((l) => l.trim()) || ''
    const preview = firstLine.replace(/^\[Tool: [^\]]+\]\s*/, '').trim().slice(0, 44)
    return {
      preview,
      lastActivity: last?.createdAt || session.createdAt,
      running: runningRoutineIds.has(session.id) || streamingSessionIds.includes(session.id),
      waiting: waitingSessions.has(session.id),
      ultra: ultraSessions.split('|').includes(session.id)
    }
  }

  const renderSessionMeta = (meta: ReturnType<typeof sessionMeta>, withPreview: boolean): React.ReactNode => (
    <>
      {meta.ultra && (
        <span className="session-ulw ulw-rainbow-text" title={'Ultra Work'}>
          ULW
        </span>
      )}
      {meta.waiting ? (
        <span className="session-waiting" title={'The agent is waiting for your answer or approval'}>
          {'Waiting'}
        </span>
      ) : (
        meta.running && <span className="session-running" title={'Running'} />
      )}
      {withPreview && meta.preview && !meta.waiting && !meta.ultra && (
        <span className="session-preview">{meta.preview}</span>
      )}
    </>
  )

  const commitRename = (): void => {
    if (!renamingSession) return
    const title = renamingSession.title.trim()
    if (title) {
      updateSessionTitle(renamingSession.projectId, renamingSession.sessionId, title)
    }
    setRenamingSession(null)
  }

  // Recent sessions (not pinned, sorted by last activity)
  const recentSessions = projects
    .flatMap((p) =>
      p.sessions
        .filter((s) => !pinnedSessions.has(s.id))
        .map((s) => ({ ...s, projectId: p.id }))
    )
    .sort((a, b) => sessionMeta(b).lastActivity - sessionMeta(a).lastActivity)
    .slice(0, 8)

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label={'Project'}>
      {/* Drag handle for resizing the sidebar width — not in tab order */}
      <div
        className="sidebar-resizer"
        ref={attachResizer}
        role="separator"
        aria-orientation="vertical"
        tabIndex={-1}
      />

      {/* Traffic light safe area + logo */}
      <div className="traffic-light-spacer" aria-hidden />
      <div className="sidebar-top-row">
        <span className="sidebar-logo">Pawn</span>
        <div className="sidebar-top-actions">
          {onOpenCommandPalette && (
            <Tooltip label={'Command palette'} shortcut={formatCombo(keybindings['open-command-palette'])} placement="bottom">
              <button
                type="button"
                className="sidebar-icon-btn"
                onClick={onOpenCommandPalette}
                aria-label={'Command palette'}
              >
                <Search size={15} aria-hidden />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Primary action: New Session */}
      <div className="sidebar-actions">
        <Tooltip label={'New chat'} shortcut={formatCombo(keybindings['new-session'])} placement="bottom">
          <button
            type="button"
            className="sidebar-action-btn"
            onClick={handleNewSession}
          >
            <Pencil size={16} aria-hidden />
            <span>{'New chat'}</span>
          </button>
        </Tooltip>
        <button
          type="button"
          className={`sidebar-action-btn ${mainView === 'automations' ? 'active' : ''}`}
          onClick={() => onMainViewChange('automations')}
          aria-current={mainView === 'automations' ? 'page' : undefined}
        >
          <History size={16} aria-hidden />
          <span>{'Automations'}</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        {/* 1. Pinned */}
        {pinnedItems.length > 0 && (
          <div className="sidebar-section">
            <div className="section-label">{'Pinned'}</div>
            {pinnedItems.map((session) => {
              const select = (): void => {
                onMainViewChange('chat')
                setActiveSession(session.id)
                setActiveProject(session.projectId)
              }
              return (
                <div
                  key={session.id}
                  className={`sidebar-item ${mainView === 'chat' && session.id === activeSessionId ? 'active' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-current={mainView === 'chat' && session.id === activeSessionId ? 'true' : undefined}
                  onClick={select}
                  onKeyDown={(e) => activateOnKey(e, select)}
                >
                  <button
                    type="button"
                    className="tree-action-btn pin"
                    tabIndex={0}
                    onClick={(e) => togglePin(e, session.id)}
                    title={'Unpin'}
                    aria-label={'Unpin'}
                  >
                    <Star size={12} fill="currentColor" aria-hidden />
                  </button>
                  <span className="item-title">{session.title}</span>
                  {renderSessionMeta(sessionMeta(session), true)}
                  <div className="sidebar-item-actions">
                    {renderArchiveButton(session.projectId, session.id)}
                    <button type="button" className="tree-action-btn delete" onClick={(e) => handleDeleteSession(e, session.projectId, session.id)} title={'Delete'} aria-label={'Delete'}>
                              <X size={9} aria-hidden />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 2. Projects */}
        <div className="sidebar-section">
          <div className="section-header">
            <span className="section-label">{'Projects'}</span>
            <button className="section-add-btn" onClick={handleAddProject} title={'Add project'} aria-label={'Add project'}>
              <Plus size={12} aria-hidden />
            </button>
          </div>
          {userProjects.map((project) => {
            // Folding is user-controlled: clicking the header toggles the set.
            // Tying it to activeProjectId here would make the active project
            // impossible to collapse.
            const isExpanded = expandedProjects.has(project.id)
            return (
              <div key={project.id} className="tree-project">
                <div
                  className={`tree-project-header ${mainView === 'chat' && project.id === activeProjectId ? 'active' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleProject(project.id)}
                  onKeyDown={(e) => activateOnKey(e, () => toggleProject(project.id))}
                >
                  <ChevronRight size={10} className={`tree-chevron ${isExpanded ? 'expanded' : ''}`} aria-hidden />
                  <Folder size={13} className="tree-folder-icon" aria-hidden />
                  <span className="tree-project-name">{project.name}</span>
                  <div className="tree-project-actions">
                    <button type="button" className="tree-action-btn" onClick={(e) => { e.stopPropagation(); addSession(project.id); if (!isExpanded) toggleProject(project.id) }} title={'New chat'} aria-label={'New chat'}>
                      <Plus size={10} aria-hidden />
                    </button>
                    <button type="button" className="tree-action-btn delete" onClick={(e) => handleDeleteProject(e, project.id)} title={'Delete'} aria-label={'Delete'}>
                      <X size={10} aria-hidden />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="tree-sessions" role="group" aria-label={project.name}>
                    {project.sessions.map((session) => {
                      const select = (): void => {
                        onMainViewChange('chat')
                        setActiveSession(session.id)
                        setActiveProject(project.id)
                      }
                      return (
                        <div
                          key={session.id}
                          className={`tree-session ${mainView === 'chat' && session.id === activeSessionId ? 'active' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-current={mainView === 'chat' && session.id === activeSessionId ? 'true' : undefined}
                          onClick={select}
                          onKeyDown={(e) => activateOnKey(e, select)}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            setRenamingSession({
                              projectId: project.id,
                              sessionId: session.id,
                              title: session.title
                            })
                          }}
                        >
                          <MessageSquare size={11} aria-hidden />
                          {renamingSession?.sessionId === session.id ? (
                            <input
                              className="tree-session-rename"
                              autoFocus
                              value={renamingSession.title}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setRenamingSession((r) => (r ? { ...r, title: e.target.value } : r))
                              }
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') commitRename()
                                if (e.key === 'Escape') setRenamingSession(null)
                              }}
                              aria-label={'Rename'}
                            />
                          ) : (
                            <span
                              className="tree-session-title"
                              title={`${session.title}\n${'Double-click to rename'}`}
                            >
                              {session.title}
                            </span>
                          )}
                          {renderSessionMeta(sessionMeta(session), false)}
                          <div className="tree-session-actions">
                            <button type="button" className="tree-action-btn pin" onClick={(e) => togglePin(e, session.id)} title={pinnedSessions.has(session.id) ? 'Unpin' : 'Pin'} aria-label={pinnedSessions.has(session.id) ? 'Unpin' : 'Pin'}>
                              <Star size={9} fill={pinnedSessions.has(session.id) ? 'currentColor' : 'none'} aria-hidden />
                            </button>
                            {renderArchiveButton(project.id, session.id)}
                            <button type="button" className="tree-action-btn delete" onClick={(e) => handleDeleteSession(e, project.id, session.id)} title={'Delete'} aria-label={'Delete'}>
                      <X size={9} aria-hidden />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {project.sessions.length === 0 && (
                      <div className="tree-empty">
                        {'No chats yet'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {initialized && userProjects.length === 0 && <div className="empty-hint">{'No projects yet'}</div>}
        </div>

        {/* 3. Recent */}
        {recentSessions.length > 0 && (
          <div className="sidebar-section">
            <button className="section-header recent-header" onClick={() => setRecentExpanded((v) => !v)}>
              <ChevronRight size={10} className={`tree-chevron ${recentExpanded ? 'expanded' : ''}`} />
              <span className="section-label">{'Recent'}</span>
            </button>
            {recentExpanded && recentSessions.map((session) => {
              const select = (): void => {
                onMainViewChange('chat')
                setActiveSession(session.id)
                setActiveProject(session.projectId)
              }
              return (
              <div
                key={session.id}
                className={`sidebar-item ${mainView === 'chat' && session.id === activeSessionId ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                aria-current={mainView === 'chat' && session.id === activeSessionId ? 'true' : undefined}
                onClick={select}
                onKeyDown={(e) => activateOnKey(e, select)}
              >
                <History size={12} aria-hidden />
                <span className="item-title">{session.title}</span>
                {renderSessionMeta(sessionMeta(session), true)}
                <div className="sidebar-item-actions">
                  {renderArchiveButton(session.projectId, session.id)}
                  <button type="button" className="tree-action-btn delete" onClick={(e) => handleDeleteSession(e, session.projectId, session.id)} title={'Delete'} aria-label={'Delete'}>
                    <X size={9} aria-hidden />
                  </button>
                </div>
              </div>
              )
            })}
          </div>
        )}

        {/* 4. Archived — soft-deleted chats, restorable until really deleted */}
        {archivedSessions.length > 0 && (
          <div className="sidebar-section">
            <button
              className="section-header recent-header"
              onClick={() => setArchivedExpanded((v) => !v)}
              aria-expanded={archivedExpanded}
            >
              <IconChevronRight size={10} className={`tree-chevron ${archivedExpanded ? 'expanded' : ''}`} />
              <span className="section-label">{'Archived'}</span>
              <span className="tree-empty">{archivedSessions.length}</span>
            </button>
            {archivedExpanded && archivedSessions.map((a) => (
              <div
                key={a.id}
                className="sidebar-item"
                role="button"
                tabIndex={0}
                onClick={() => handleRestoreSession(a.id, true)}
                onKeyDown={(e) => activateOnKey(e, () => handleRestoreSession(a.id, true))}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
                <span className="item-title" title={a.title}>{a.title}</span>
                {a.projectId !== GENERAL_PROJECT_ID && <span className="session-preview">{a.projectName}</span>}
                <div className="sidebar-item-actions">
                  <button
                    type="button"
                    className="tree-action-btn"
                    onClick={(e) => { e.stopPropagation(); handleRestoreSession(a.id, false) }}
                    title={'Restore'}
                    aria-label={'Restore'}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                  </button>
                  <button
                    type="button"
                    className="tree-action-btn delete"
                    onClick={(e) => { e.stopPropagation(); handleDeleteArchivedSession(a.id) }}
                    title={'Delete'}
                    aria-label={'Delete'}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <Tooltip label={'Settings'} shortcut={formatCombo(keybindings['open-settings'])} placement="top">
          <button type="button" className="footer-btn" onClick={onOpenSettings} aria-label={'Settings'}>
            <Settings size={14} />
            <span>{'Settings'}</span>
          </button>
        </Tooltip>
      </div>

      {showProjectDialog && (
        <ProjectEditDialog projectId={editingProjectId} onClose={() => setShowProjectDialog(false)} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`${confirmDelete.name} ${'Delete'}`}
          message={
            confirmDelete.type === 'project'
              ? 'Delete this project? This can\'t be undone.'
              : confirmDelete.type === 'archivedSession'
                ? 'Permanently delete this archived chat? This can\'t be undone.'
                : 'Delete this chat? This can\'t be undone.'
          }
          confirmLabel={'Confirm'}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </aside>
  )
}
