import { create } from 'zustand'
import { uid } from '../utils/uid'
import { clearSessionRoute } from '../agent/router'
import { useUsageStore } from './usage'
import { enqueueDbWrite } from '../utils/dbWriteQueue'

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
  /** Display label of the model that produced this message (auto mode only). */
  modelLabel?: string
  /** Model reasoning / chain-of-thought shown in a collapsible block (not in content). */
  thinking?: string
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
  /** Sessions with an in-flight message fetch (for skeleton UI). */
  loadingSessions: Set<string>
  init: () => Promise<void>
  addProject: (name: string, paths: string[], id?: string) => void
  removeProject: (id: string) => void
  setActiveProject: (id: string) => void
  updateProjectName: (projectId: string, name: string) => void
  updateProjectPaths: (projectId: string, paths: string[]) => void
  addSession: (projectId: string, title?: string, opts?: { focus?: boolean }) => string
  /** Ensure the hidden “no project” bucket exists; returns its id (`__general__`). */
  ensureGeneralProject: () => string
  /**
   * Sidebar / shortcut “New chat”: always start unbound from any real project
   * (sessions under `__general__`). Project-scoped sessions use addSession(projectId).
   */
  startNewChat: (title?: string) => string
  removeSession: (projectId: string, sessionId: string) => void
  setActiveSession: (id: string | null) => void
  loadMessages: (projectId: string, sessionId: string) => Promise<void>
  addMessage: (projectId: string, sessionId: string, message: Message) => void
  updateMessageContent: (
    projectId: string,
    sessionId: string,
    messageId: string,
    content: string,
    persist?: boolean
  ) => void
  updateMessageThinking: (
    projectId: string,
    sessionId: string,
    messageId: string,
    thinking: string
  ) => void
  updateMessageModel: (projectId: string, sessionId: string, messageId: string, modelLabel: string) => void
  /** Drop messages from index of messageId (inclusive) through the end. */
  truncateMessagesFrom: (
    projectId: string,
    sessionId: string,
    messageId: string,
    opts?: { includeSelf?: boolean }
  ) => void
  updateSessionPath: (projectId: string, sessionId: string, path: string) => void
  removeMessage: (projectId: string, sessionId: string, messageId: string) => void
  updateSessionTitle: (projectId: string, sessionId: string, title: string) => void
  clearMessages: (projectId: string, sessionId: string) => void
}

// Streaming updates the bubble at up to 60 Hz; persisting each frame would push
// hundreds of full-text IPC writes through the main process. Intermediate
// writes are throttled; the final flush always persists.
const MESSAGE_PERSIST_INTERVAL_MS = 800
const messagePersistTimes = new Map<string, number>()

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  initialized: false,
  loadedSessions: new Set<string>(),
  loadingSessions: new Set<string>(),

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
    window.api.db.addProject(id, name, JSON.stringify(paths)).catch(() => {})
  },

  removeProject: (id) => {
    for (const s of get().projects.find((p) => p.id === id)?.sessions || []) {
      useUsageStore.getState().reset(s.id)
    }
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId
    }))
    window.api.db.removeProject(id).catch(() => {})
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  updateProjectName: (projectId, name) => {
    set((s) => ({
      projects: s.projects.map((p) => p.id === projectId ? { ...p, name } : p)
    }))
    window.api.db.updateProjectName(projectId, name).catch(() => {})
  },

  updateProjectPaths: (projectId, paths) => {
    set((s) => ({
      projects: s.projects.map((p) => p.id === projectId ? { ...p, paths } : p)
    }))
    window.api.db.updateProjectPaths(projectId, JSON.stringify(paths)).catch(() => {})
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
    window.api.db.addSession(id, projectId, session.title, '').catch(() => {})
    return id
  },

  ensureGeneralProject: () => {
    const GENERAL = '__general__'
    if (get().projects.some((p) => p.id === GENERAL)) return GENERAL
    get().addProject('General', [], GENERAL)
    return GENERAL
  },

  startNewChat: (title) => {
    const projectId = get().ensureGeneralProject()
    return get().addSession(projectId, title)
  },

  removeSession: (projectId, sessionId) => {
    useUsageStore.getState().reset(sessionId)
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
    window.api.db.removeSession(sessionId).catch(() => {})
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id })
    // Do NOT clearAll streaming buffers here. Live tokens are keyed by message
    // id; MessageRow only subscribes to its own id. Wiping on switch blanks the
    // in-progress bubble if the user leaves and returns mid-stream.
    // Trigger lazy message load for the activated session
    if (!id) return
    const state = get()
    const project = state.projects.find((p) => p.sessions.some((s) => s.id === id))
    if (project && !state.loadedSessions.has(id) && !state.loadingSessions.has(id)) {
      state.loadMessages(project.id, id)
    }
    // Restore durable cost totals after reload / session switch.
    void import('./usage')
      .then(({ useUsageStore }) => useUsageStore.getState().hydrateSession(id))
      .catch(() => {})
  },

  loadMessages: async (projectId, sessionId) => {
    // Claim the in-flight slot atomically so two callers can't both fetch.
    let claimed = false
    set((s) => {
      if (s.loadedSessions.has(sessionId) || s.loadingSessions.has(sessionId)) return s
      claimed = true
      return { loadingSessions: new Set([...s.loadingSessions, sessionId]) }
    })
    if (!claimed) return
    try {
      const raw = await window.api.db.getMessages(sessionId)
      const fetched: Message[] = Array.isArray(raw) ? (raw as Message[]) : []
      set((s) => {
        // Session may have been deleted while the fetch was in flight.
        const stillExists = s.projects.some((p) => p.sessions.some((ss) => ss.id === sessionId))
        const loading = new Set(s.loadingSessions)
        loading.delete(sessionId)
        if (!stillExists) {
          return { loadingSessions: loading }
        }
        return {
          loadingSessions: loading,
          loadedSessions: new Set([...s.loadedSessions, sessionId]),
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  sessions: p.sessions.map((ss) => {
                    if (ss.id !== sessionId) return ss
                    // Merge local + fetched. Prefer local when the same id already
                    // exists in memory with different content (stream may have
                    // advanced past the last DB flush mid-fetch).
                    const byId = new Map(fetched.map((m) => [m.id, m]))
                    for (const local of ss.messages) {
                      const remote = byId.get(local.id)
                      if (!remote) {
                        byId.set(local.id, local)
                        continue
                      }
                      const localNewer =
                        (local.createdAt || 0) > (remote.createdAt || 0) ||
                        (local.content?.length || 0) > (remote.content?.length || 0) ||
                        Boolean(local.modelLabel && !remote.modelLabel)
                      if (localNewer) {
                        byId.set(local.id, {
                          ...remote,
                          ...local,
                          // Keep whichever model label is set.
                          modelLabel: local.modelLabel || remote.modelLabel
                        })
                      }
                    }
                    const merged = Array.from(byId.values())
                    merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
                    return { ...ss, messages: merged }
                  })
                }
              : p
          )
        }
      })
    } catch {
      // Mark as loaded even on error to avoid infinite retries
      set((s) => {
        const loading = new Set(s.loadingSessions)
        loading.delete(sessionId)
        return {
          loadingSessions: loading,
          loadedSessions: new Set([...s.loadedSessions, sessionId])
        }
      })
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
    enqueueDbWrite(`msg:add:${message.id}`, () =>
      window.api.db.addMessage(message.id, sessionId, message.role, message.content)
    )
  },

  updateMessageContent: (projectId, sessionId, messageId, content, persist = true) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: ss.messages.map((m) => m.id === messageId ? { ...m, content } : m) } : ss) }
          : p
      )
    }))
    const now = Date.now()
    const last = messagePersistTimes.get(messageId) || 0
    if (persist || now - last >= MESSAGE_PERSIST_INTERVAL_MS) {
      messagePersistTimes.set(messageId, now)
      enqueueDbWrite(`msg:upd:${messageId}`, () =>
        window.api.db.updateMessageContent(messageId, content)
      )
    }
  },

  updateMessageModel: (projectId, sessionId, messageId, modelLabel) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: ss.messages.map((m) => m.id === messageId ? { ...m, modelLabel } : m) } : ss) }
          : p
      )
    }))
  },

  updateMessageThinking: (projectId, sessionId, messageId, thinking) => {
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
                        m.id === messageId ? { ...m, thinking } : m
                      )
                    }
                  : ss
              )
            }
          : p
      )
    }))
    // Thinking is display-only for now (not in SQLite schema) — survives the session in memory.
  },

  truncateMessagesFrom: (projectId, sessionId, messageId, opts) => {
    const includeSelf = opts?.includeSelf !== false
    const session = get()
      .projects.find((p) => p.id === projectId)
      ?.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const idx = session.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    const from = includeSelf ? idx : idx + 1
    const doomed = session.messages.slice(from)
    for (const m of doomed) messagePersistTimes.delete(m.id)
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              sessions: p.sessions.map((ss) =>
                ss.id === sessionId
                  ? { ...ss, messages: ss.messages.slice(0, from) }
                  : ss
              )
            }
          : p
      )
    }))
    for (const m of doomed) {
      enqueueDbWrite(`msg:del:${m.id}`, () => window.api.db.deleteMessage(m.id))
    }
  },

  updateSessionPath: (projectId, sessionId, path) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              sessions: p.sessions.map((ss) =>
                ss.id === sessionId ? { ...ss, path } : ss
              )
            }
          : p
      )
    }))
    void window.api.db.updateSessionPath?.(sessionId, path)?.catch?.(() => {})
  },

  removeMessage: (projectId, sessionId, messageId) => {
    messagePersistTimes.delete(messageId)
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: ss.messages.filter((m) => m.id !== messageId) } : ss) }
          : p
      )
    }))
    enqueueDbWrite(`msg:del:${messageId}`, () => window.api.db.deleteMessage(messageId))
  },

  updateSessionTitle: (projectId, sessionId, title) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, title } : ss) } : p
      )
    }))
    window.api.db.updateSessionTitle(sessionId, title).catch(() => {})
  },

  clearMessages: (projectId, sessionId) => {
    useUsageStore.getState().reset(sessionId)
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((ss) => ss.id === sessionId ? { ...ss, messages: [] } : ss) }
          : p
      )
    }))
    // Also drops the replayed API transcript on the backend, so a cleared
    // session really starts cold instead of silently resending the old thread.
    window.api.db.clearMessages(sessionId).catch(() => {})
    clearSessionRoute(sessionId)
  }
}))
