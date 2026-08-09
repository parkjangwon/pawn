// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '../app'
import { __flushDbWriteQueueForTests, __resetDbWriteQueueForTests } from '../../utils/dbWriteQueue'

const dbMock = {
  loadAll: vi.fn(),
  addProject: vi.fn(),
  removeProject: vi.fn(),
  updateProjectName: vi.fn(),
  updateProjectPaths: vi.fn(),
  addSession: vi.fn(),
  removeSession: vi.fn(),
  getMessages: vi.fn(),
  addMessage: vi.fn(),
  updateMessageContent: vi.fn(),
  deleteMessage: vi.fn(),
  clearMessages: vi.fn(),
  updateSessionTitle: vi.fn(),
  getUsageBySession: vi.fn()
}

beforeEach(() => {
  __resetDbWriteQueueForTests()
  ;(window as any).api = { db: dbMock }
  useAppStore.setState({
    projects: [],
    activeProjectId: null,
    activeSessionId: null,
    initialized: false,
    loadedSessions: new Set()
  })
  for (const fn of Object.values(dbMock)) fn.mockClear()
  dbMock.loadAll.mockResolvedValue({ projects: [] })
  dbMock.getMessages.mockResolvedValue([])
  dbMock.getUsageBySession.mockResolvedValue([])
  for (const fn of [
    dbMock.addProject, dbMock.removeProject, dbMock.updateProjectName, dbMock.updateProjectPaths,
    dbMock.addSession, dbMock.removeSession, dbMock.addMessage, dbMock.updateMessageContent,
    dbMock.deleteMessage, dbMock.clearMessages, dbMock.updateSessionTitle
  ]) {
    fn.mockResolvedValue({ ok: true })
  }
})

describe('app store init', () => {
  it('hydrates projects, parsing JSON paths and skipping messages', async () => {
    dbMock.loadAll.mockResolvedValue({
      projects: [
        { id: 'p1', name: 'One', path: '["/a","/b"]', sessions: [{ id: 's1', title: 'S1', path: '/a', createdAt: 5 }] },
        { id: 'p2', name: 'Two', path: '/plain', sessions: [] }
      ]
    })
    await useAppStore.getState().init()

    const state = useAppStore.getState()
    expect(state.initialized).toBe(true)
    expect(state.projects[0].paths).toEqual(['/a', '/b'])
    expect(state.projects[1].paths).toEqual(['/plain'])
    expect(state.projects[0].sessions[0].messages).toEqual([])
  })

  it('marks initialized even when loading fails', async () => {
    dbMock.loadAll.mockRejectedValue(new Error('db down'))
    await useAppStore.getState().init()
    expect(useAppStore.getState().initialized).toBe(true)
    expect(useAppStore.getState().projects).toEqual([])
  })
})

describe('project actions', () => {
  it('adds, updates, activates and removes projects', () => {
    useAppStore.getState().addProject('Alpha', ['/alpha'], 'p1')
    expect(useAppStore.getState().activeProjectId).toBe('p1')
    expect(dbMock.addProject).toHaveBeenCalledWith('p1', 'Alpha', '["/alpha"]')

    useAppStore.getState().updateProjectName('p1', 'Beta')
    expect(useAppStore.getState().projects[0].name).toBe('Beta')

    useAppStore.getState().updateProjectPaths('p1', ['/beta'])
    expect(dbMock.updateProjectPaths).toHaveBeenCalledWith('p1', '["/beta"]')

    useAppStore.getState().removeProject('p1')
    expect(useAppStore.getState().projects).toHaveLength(0)
    expect(useAppStore.getState().activeProjectId).toBeNull()
  })
})

describe('session actions', () => {
  it('adds sessions with a generated id and marks them loaded', () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'Session A')
    const state = useAppStore.getState()
    const session = state.projects[0].sessions[0]
    expect(session.title).toBe('Session A')
    expect(state.activeSessionId).toBe(session.id)
    expect(state.loadedSessions.has(session.id)).toBe(true)
    expect(dbMock.addSession).toHaveBeenCalledWith(session.id, 'p1', 'Session A', '')
  })

  it('removes sessions and clears the active id', () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'S')
    const sessionId = useAppStore.getState().activeSessionId!
    useAppStore.getState().removeSession('p1', sessionId)
    expect(useAppStore.getState().projects[0].sessions).toHaveLength(0)
    expect(useAppStore.getState().activeSessionId).toBeNull()
    expect(dbMock.removeSession).toHaveBeenCalledWith(sessionId)
  })

  it('updates session titles', () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'Old')
    const sessionId = useAppStore.getState().activeSessionId!
    useAppStore.getState().updateSessionTitle('p1', sessionId, 'New')
    expect(useAppStore.getState().projects[0].sessions[0].title).toBe('New')
    expect(dbMock.updateSessionTitle).toHaveBeenCalledWith(sessionId, 'New')
  })
})

describe('message actions', () => {
  it('adds messages to the session and persists them', async () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'S')
    const sessionId = useAppStore.getState().activeSessionId!

    useAppStore.getState().addMessage('p1', sessionId, { id: 'm1', role: 'user', content: 'hi', createdAt: 1 })
    expect(useAppStore.getState().projects[0].sessions[0].messages).toHaveLength(1)
    await __flushDbWriteQueueForTests()
    expect(dbMock.addMessage).toHaveBeenCalledWith('m1', sessionId, 'user', 'hi')
  })

  it('loads messages once per session', async () => {
    useAppStore.setState({
      projects: [{
        id: 'p1', name: 'P', paths: ['/p'],
        sessions: [{ id: 's1', title: 'S', path: '', createdAt: 1, messages: [] }]
      }],
      activeProjectId: 'p1',
      activeSessionId: 's1',
      loadedSessions: new Set()
    })
    dbMock.getMessages.mockResolvedValue([{ id: 'm1', role: 'user', content: 'loaded', createdAt: 2 }])

    await useAppStore.getState().loadMessages('p1', 's1')
    expect(useAppStore.getState().projects[0].sessions[0].messages[0].content).toBe('loaded')

    await useAppStore.getState().loadMessages('p1', 's1')
    expect(dbMock.getMessages).toHaveBeenCalledTimes(1)
  })

  it('keeps locally added messages that arrived while loading', async () => {
    useAppStore.setState({
      projects: [{
        id: 'p1', name: 'P', paths: ['/p'],
        sessions: [{ id: 's1', title: 'S', path: '', createdAt: 1, messages: [{ id: 'local-1', role: 'user', content: 'sent during load', createdAt: 9 }] }]
      }],
      activeProjectId: 'p1',
      activeSessionId: 's1',
      loadedSessions: new Set()
    })
    dbMock.getMessages.mockResolvedValue([{ id: 'm1', role: 'assistant', content: 'loaded', createdAt: 2 }])

    await useAppStore.getState().loadMessages('p1', 's1')
    const messages = useAppStore.getState().projects[0].sessions[0].messages
    expect(messages).toHaveLength(2)
    expect(messages.map((m) => m.id)).toContain('local-1')
    expect(messages.map((m) => m.id)).toContain('m1')
    // Order by createdAt: loaded (2) first, local (9) last.
    expect(messages[0].id).toBe('m1')
    expect(messages[1].id).toBe('local-1')
  })

  it('prefers in-memory streamed content over stale DB rows', async () => {
    useAppStore.setState({
      projects: [{
        id: 'p1', name: 'P', paths: ['/p'],
        sessions: [{
          id: 's1', title: 'S', path: '', createdAt: 1,
          messages: [{ id: 'a1', role: 'assistant', content: 'live longer text from stream', createdAt: 5 }]
        }]
      }],
      activeProjectId: 'p1',
      activeSessionId: 's1',
      loadedSessions: new Set(),
      loadingSessions: new Set()
    })
    dbMock.getMessages.mockResolvedValue([
      { id: 'a1', role: 'assistant', content: 'stale', createdAt: 5 }
    ])
    await useAppStore.getState().loadMessages('p1', 's1')
    const msg = useAppStore.getState().projects[0].sessions[0].messages.find((m) => m.id === 'a1')
    expect(msg?.content).toBe('live longer text from stream')
  })

  it('does not start a second load while one is in flight', async () => {
    let release!: (v: unknown) => void
    const gate = new Promise((r) => { release = r })
    dbMock.getMessages.mockImplementation(() => gate as Promise<unknown[]>)
    useAppStore.setState({
      projects: [{
        id: 'p1', name: 'P', paths: ['/p'],
        sessions: [{ id: 's1', title: 'S', path: '', createdAt: 1, messages: [] }]
      }],
      activeProjectId: 'p1',
      activeSessionId: 's1',
      loadedSessions: new Set(),
      loadingSessions: new Set()
    })
    const p1 = useAppStore.getState().loadMessages('p1', 's1')
    const p2 = useAppStore.getState().loadMessages('p1', 's1')
    expect(useAppStore.getState().loadingSessions.has('s1')).toBe(true)
    release([])
    await Promise.all([p1, p2])
    expect(dbMock.getMessages).toHaveBeenCalledTimes(1)
  })

  it('updates, deletes and clears messages', async () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'S')
    const sessionId = useAppStore.getState().activeSessionId!
    useAppStore.getState().addMessage('p1', sessionId, { id: 'm1', role: 'user', content: 'a', createdAt: 1 })
    useAppStore.getState().addMessage('p1', sessionId, { id: 'm2', role: 'assistant', content: 'b', createdAt: 2 })
    await __flushDbWriteQueueForTests()

    useAppStore.getState().updateMessageContent('p1', sessionId, 'm1', 'a2')
    await __flushDbWriteQueueForTests()
    expect(dbMock.updateMessageContent).toHaveBeenCalledWith('m1', 'a2')

    useAppStore.getState().removeMessage('p1', sessionId, 'm2')
    await __flushDbWriteQueueForTests()
    expect(dbMock.deleteMessage).toHaveBeenCalledWith('m2')
    expect(useAppStore.getState().projects[0].sessions[0].messages.map((m) => m.id)).toEqual(['m1'])

    useAppStore.getState().clearMessages('p1', sessionId)
    await __flushDbWriteQueueForTests()
    expect(useAppStore.getState().projects[0].sessions[0].messages).toHaveLength(0)
    expect(dbMock.clearMessages).toHaveBeenCalledWith(sessionId)
  })
})
