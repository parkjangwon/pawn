import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Session {
  id: string
  title: string
  createdAt: number
  messages: Message[]
  path?: string
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
  path: string
  sessions: Session[]
}

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  activeSessionId: string | null
  addProject: (name: string, path: string) => void
  removeProject: (id: string) => void
  setActiveProject: (id: string) => void
  addSession: (projectId: string, title?: string) => void
  removeSession: (projectId: string, sessionId: string) => void
  setActiveSession: (id: string) => void
  addMessage: (projectId: string, sessionId: string, message: Message) => void
  updateMessageContent: (projectId: string, sessionId: string, messageId: string, content: string) => void
  updateSessionTitle: (projectId: string, sessionId: string, title: string) => void
  updateSessionPath: (projectId: string, sessionId: string, path: string) => void
  updateProjectName: (projectId: string, name: string) => void
}

let counter = 0
const uid = (): string => `${Date.now()}-${++counter}`

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,
      activeSessionId: null,

      addProject: (name, path) =>
        set((s) => {
          const project: Project = { id: uid(), name, path, sessions: [] }
          return { projects: [...s.projects, project], activeProjectId: project.id }
        }),

      removeProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId
        })),

      setActiveProject: (id) => set({ activeProjectId: id }),

      addSession: (projectId, title) =>
        set((s) => {
          const session: Session = {
            id: uid(),
            title: title || 'New Session',
            createdAt: Date.now(),
            messages: []
          }
          return {
            projects: s.projects.map((p) =>
              p.id === projectId ? { ...p, sessions: [...p.sessions, session] } : p
            ),
            activeSessionId: session.id
          }
        }),

      removeSession: (projectId, sessionId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, sessions: p.sessions.filter((ss) => ss.id !== sessionId) }
              : p
          ),
          activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId
        })),

      setActiveSession: (id) => set({ activeSessionId: id }),

      addMessage: (projectId, sessionId, message) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  sessions: p.sessions.map((ss) =>
                    ss.id === sessionId
                      ? { ...ss, messages: [...ss.messages, message] }
                      : ss
                  )
                }
              : p
          )
        })),

      updateMessageContent: (projectId, sessionId, messageId, content) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  sessions: p.sessions.map((ss) =>
                    ss.id === sessionId
                      ? {
                          ...ss,
                          messages: ss.messages.map((m) =>
                            m.id === messageId ? { ...m, content } : m
                          )
                        }
                      : ss
                  )
                }
              : p
          )
        })),

      updateSessionTitle: (projectId, sessionId, title) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  sessions: p.sessions.map((ss) =>
                    ss.id === sessionId ? { ...ss, title } : ss
                  )
                }
              : p
          )
        })),

      updateSessionPath: (projectId, sessionId, path) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  sessions: p.sessions.map((ss) =>
                    ss.id === sessionId ? { ...ss, path: path || undefined } : ss
                  )
                }
              : p
          )
        })),

      updateProjectName: (projectId, name) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId ? { ...p, name } : p
          )
        }))
    }),
    { name: 'pawn-app-state' }
  )
)
