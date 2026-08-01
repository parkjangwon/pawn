import { create } from 'zustand'
import { uid } from '../utils/uid'
import { clearSessionRoute } from '../agent/router'

export interface Session {
  id: string
  title: string
  path: string
  createdAt: number
  messages: Message[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
}

export interface Project {
  id: string
  name: string
  paths: string[]
  sessions: Session[]
}

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  activeSessionId: string | null
  initialized: boolean
  loadedSessions: Set<string>
  init: () => Promise<void>
  addProject: (name: string, paths: string[], id?: string) => void
  removeProject: (id: string) => void
  setActiveProject: (id: string) => void
  updateProjectName: (projectId: string, name: string) => void
  updateProjectPaths: (projectId: string, paths: string[]) => void
  addSession: (projectId: string, title?: string, opts?: { focus?: boolean }) => string
  removeSession: (projectId: string, sessionId: string) => void
  setActiveSession: (id: string) => void
  loadMessages: (projectId: string, sessionId: string) => Promise<void>
  addMessage: (projectId: string, sessionId: string, message: Message) => void
  updateMessageContent: (projectId: string, sessionId: string, messageId: string, content: string) => void
  removeMessage: (projectId: string, sessionId: string, messageId: string) => void
  updateSessionTitle: (projectId: string, sessionId: string, title: string) => void
  clearMessages: (projectId: string, sessionId: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  initialized: false,
  loadedSessions: new Set<string>(),

  init: async () => {
    if (get().initialized) return
    try {
      const state = await window.api.db.loadAll()
      // Parse paths from JSON string stored in DB; sessions load messages lazily
      const projects = (state.projects || []).map((p: Record<string, unknown>) => {
        let paths: string[] = []
        const rawPath = (p.path as string) || (p.paths as string) || ''
        try { paths = JSON.parse(rawPath) } catch { paths = rawPath ? [rawPath] : [] }
        const sessions = ((p.sessions as Array<Record<string, unknown>>) || []).map((s) => ({
          id: s.id as string,
          title: (s.title as string) || 'New Session',
          path: (s.path as string) || '',
          createdAt: (s.createdAt as number) || Date.now(),
          messages: []
        })) as Session[]
        return { id: p.id as string, name: p.name as string, paths, sessions }
      }) as Project[]
      set({ projects, initialized: true })
    } catch {
      set({ initialized: true })
    }
  },

  addProject: (name, paths, id) => {
    id = id || uid()
    const project: Project = { id, name, paths, sessions: [] }
    set((s) => ({ projects: [...s.projects, project], activeProjectId: id }))
    window.api.db.addProject(id, name, JSON.stringify(paths))
  },

  removeProject: (id) => {
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId
    }))
    window.api.db.removeProject(id)
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  updateProjectName: (projectId, name) => {
    set((s) => ({
      projects: s.projects.map((p) => p.id === projectId ? { ...p, name } : p)
    }))
    window.api.db.updateProjectName(projectId, name)
  },

  updateProjectPaths: (projectId, paths) => {
    set((s) => ({
      projects: s.projects.map((p) => p.id === projectId ? { ...p, paths } : p)
    }))
    window.api.db.updateProjectPaths(projectId, JSON.stringify(paths))
  },

  addSession: (projectId, title, opts) => {
    const id = uid()
    const session: Session = { id, title: title || 'New Session', path: '', createdAt: Date.now(), messages: [] }
    const focus = opts?.focus !== false
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, sessions: [...p.sessions, session] } : p
      ),
      // Focus the new session unless the caller explicitly opted out (e.g. a
      // background routine that must not yank the user's view away).
      activeProjectId: focus ? projectId : s.activeProjectId,
      activeSessionId: focus ? id : s.activeSessionId,
      // New sessions start as already "loaded" since they have no messages in DB yet
      loadedSessions: new Set([...s.loadedSessions, id])
    }))
    window.api.db.addSession(id, projectId, session.title, '')
    return id
  },

  removeSession: (projectId, sessionId) => {
    set((s) => {
      const next = new Set(s.loadedSessions)
      next.delete(sessionId)
      return {
        projects: s.projects.map((p) =>
          p.id === projectId ? { ...p, sessions: p.sessions.filter((ss) => ss.id !== sessionId) } : p
        ),
        activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
        loadedSessions: next
      }
    })
    window.api.db.removeSession(sessionId)
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id })
    // Trigger lazy message load for the activated session
    const state = get()
    const project = state.projects.find((p) => p.sessions.some((s) => s.id === id))
    if (project && !state.loadedSessions.has(id)) {
      state.loadMessages(project.id, id)
    }
  },

  loadMessages: async (projectId, sessionId) => {
    if (get().loadedSessions.has(sessionId)) return
    try {
      const raw = await window.api.db.getMessages(sessionId)
      const messages: Message[] = Array.isArray(raw) ? (raw as Message[]) : []
      set((s) => ({
        loadedSessions: new Set([...s.loadedSessions, sessionId]),
        projects: s.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                sessions: p.sessions.map((ss) =>
                  ss.id === sessionId ? { ...ss, messages } : ss
                )
              }
            : p
        )
      }))
    } catch {
      // Mark as loaded even on error to avoid infinite retries
      set((s) => ({ loadedSessions: new Set([...s.loadedSessions, sessionId]) }))
    }
  },

  addMessage: (projectId, sessionId, message) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: [...ss.messages, message] } : ss) }
          : p
      )
    }))
    window.api.db.addMessage(message.id, sessionId, message.role, message.content)
  },

  updateMessageContent: (projectId, sessionId, messageId, content) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: ss.messages.map((m) => m.id === messageId ? { ...m, content } : m) } : ss) }
          : p
      )
    }))
    window.api.db.updateMessageContent(messageId, content)
  },

  removeMessage: (projectId, sessionId, messageId) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: ss.messages.filter((m) => m.id !== messageId) } : ss) }
          : p
      )
    }))
    window.api.db.deleteMessage(messageId)
  },

  updateSessionTitle: (projectId, sessionId, title) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, title } : ss) } : p
      )
    }))
    window.api.db.updateSessionTitle(sessionId, title)
  },

  clearMessages: (projectId, sessionId) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: [] } : ss) }
          : p
      )
    }))
    // Also drops the replayed API transcript on the backend, so a cleared
    // session really starts cold instead of silently resending the old thread.
    window.api.db.clearMessages(sessionId)
    clearSessionRoute(sessionId)
  }
}))
