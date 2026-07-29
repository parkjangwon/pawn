import { create } from 'zustand'

export interface Session {
  id: string
  title: string
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
  init: () => Promise<void>
  addProject: (name: string, paths: string[]) => void
  removeProject: (id: string) => void
  setActiveProject: (id: string) => void
  updateProjectName: (projectId: string, name: string) => void
  updateProjectPaths: (projectId: string, paths: string[]) => void
  addSession: (projectId: string, title?: string) => void
  removeSession: (projectId: string, sessionId: string) => void
  setActiveSession: (id: string) => void
  addMessage: (projectId: string, sessionId: string, message: Message) => void
  updateMessageContent: (projectId: string, sessionId: string, messageId: string, content: string) => void
  updateSessionTitle: (projectId: string, sessionId: string, title: string) => void
}

let counter = 0
const uid = (): string => `${Date.now()}-${++counter}`

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return
    try {
      const state = await window.api.db.loadAll()
      // Parse paths from JSON string stored in DB
      const projects = (state.projects || []).map((p: Record<string, unknown>) => {
        let paths: string[] = []
        const rawPath = p.path as string || p.paths as string || ''
        try { paths = JSON.parse(rawPath) } catch { paths = rawPath ? [rawPath] : [] }
        return { ...p, paths, path: undefined } as unknown as Project
      })
      set({ projects, initialized: true })
    } catch {
      set({ initialized: true })
    }
  },

  addProject: (name, paths) => {
    const id = uid()
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

  addSession: (projectId, title) => {
    const id = uid()
    const session: Session = { id, title: title || 'New Session', createdAt: Date.now(), messages: [] }
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, sessions: [...p.sessions, session] } : p
      ),
      activeSessionId: id
    }))
    window.api.db.addSession(id, projectId, session.title, '')
  },

  removeSession: (projectId, sessionId) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, sessions: p.sessions.filter((ss) => ss.id !== sessionId) } : p
      ),
      activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId
    }))
    window.api.db.removeSession(sessionId)
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

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

  updateSessionTitle: (projectId, sessionId, title) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, title } : ss) } : p
      )
    }))
    window.api.db.updateSessionTitle(sessionId, title)
  }
}))
