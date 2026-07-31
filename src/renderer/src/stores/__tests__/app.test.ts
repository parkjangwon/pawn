// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '../app'

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
  updateSessionTitle: vi.fn()
}

beforeEach(() => {
  ;(window as any).api = { db: dbMock }
  useAppStore.setState({
    projects: [],
    activeProjectId: null,
    activeSessionId: null,
    initialized: false,
    loadedSessions: new Set()
  })
  for (const fn of Object.values(dbMock)) fn.mockClear()
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
  it('adds messages to the session and persists them', () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'S')
    const sessionId = useAppStore.getState().activeSessionId!

    useAppStore.getState().addMessage('p1', sessionId, { id: 'm1', role: 'user', content: 'hi', createdAt: 1 })
    expect(useAppStore.getState().projects[0].sessions[0].messages).toHaveLength(1)
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

  it('updates, deletes and clears messages', () => {
    useAppStore.getState().addProject('P', ['/p'], 'p1')
    useAppStore.getState().addSession('p1', 'S')
    const sessionId = useAppStore.getState().activeSessionId!
    useAppStore.getState().addMessage('p1', sessionId, { id: 'm1', role: 'user', content: 'a', createdAt: 1 })
    useAppStore.getState().addMessage('p1', sessionId, { id: 'm2', role: 'assistant', content: 'b', createdAt: 2 })

    useAppStore.getState().updateMessageContent('p1', sessionId, 'm1', 'a2')
    expect(dbMock.updateMessageContent).toHaveBeenCalledWith('m1', 'a2')

    useAppStore.getState().removeMessage('p1', sessionId, 'm2')
    expect(dbMock.deleteMessage).toHaveBeenCalledWith('m2')
    expect(useAppStore.getState().projects[0].sessions[0].messages.map((m) => m.id)).toEqual(['m1'])

    useAppStore.getState().clearMessages('p1', sessionId)
    expect(useAppStore.getState().projects[0].sessions[0].messages).toHaveLength(0)
    expect(dbMock.clearMessages).toHaveBeenCalledWith(sessionId)
  })
})
