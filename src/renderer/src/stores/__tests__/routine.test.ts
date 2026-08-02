// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoutineStore, runRoutine } from '../routine'
import { useAppStore } from '../app'
import { useChatStore } from '../chat'

const routineApi = {
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  setEnabled: vi.fn(),
  remove: vi.fn(),
  recordResult: vi.fn(),
  onFire: vi.fn()
}

const sendMessageMock = vi.fn()
const notifyMock = vi.fn()
const fsMock = {
  homeDir: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn()
}

const makeRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  name: 'Morning',
  schedule: '{"type":"daily","hour":9,"minute":0}',
  prompt: 'Summarize the inbox',
  projectId: 'p1',
  sessionId: 's1',
  enabled: true,
  nextRunAt: 1,
  lastRunAt: 0,
  lastResult: '',
  createdAt: 1,
  ...overrides
})

beforeEach(() => {
  ;(window as any).api = {
    routine: routineApi,
    notification: { send: notifyMock },
    db: { addProject: vi.fn().mockResolvedValue({ ok: true }), addSession: vi.fn().mockResolvedValue({ ok: true }) },
    fs: fsMock
  }
  for (const fn of Object.values(routineApi)) fn.mockReset()
  notifyMock.mockReset()
  sendMessageMock.mockReset()
  fsMock.homeDir.mockReset().mockResolvedValue('/home/user')
  fsMock.mkdir.mockReset().mockResolvedValue({ ok: true })
  fsMock.writeFile.mockReset().mockResolvedValue({ ok: true })

  useAppStore.setState({
    projects: [{
      id: 'p1', name: 'P', paths: ['/p'],
      sessions: [{
        id: 's1', title: 'S', path: '/p', createdAt: 1,
        messages: [{ id: 'm1', role: 'assistant', content: 'summary done', createdAt: 2 }]
      }]
    }],
    activeProjectId: 'p1',
    activeSessionId: 's1'
  })
  useRoutineStore.setState({ routines: [], runningIds: new Set() })
  useChatStore.setState({
    isStreaming: false,
    queue: [],
    sendMessage: sendMessageMock,
    stopStreaming: () => {}
  })
})

describe('routine store', () => {
  it('loads routines and subscribes to fires on init', async () => {
    const rows = [makeRoutine()]
    routineApi.list.mockResolvedValue(rows)
    await useRoutineStore.getState().init()
    expect(useRoutineStore.getState().routines).toEqual(rows)
    expect(routineApi.onFire).toHaveBeenCalledTimes(1)
  })

  it('adds a routine with a JSON schedule', async () => {
    routineApi.add.mockResolvedValue({ ok: true })
    routineApi.list.mockResolvedValue([makeRoutine()])
    await useRoutineStore.getState().add({
      name: 'Nightly',
      prompt: 'Write a log',
      schedule: { type: 'interval', minutes: 60 }
    })
    const input = routineApi.add.mock.calls[0][0]
    expect(input.name).toBe('Nightly')
    expect(input.schedule).toBe('{"type":"interval","minutes":60}')
    expect(useRoutineStore.getState().routines).toHaveLength(1)
  })

  it('runs a routine in its bound session and records the result', async () => {
    await runRoutine(makeRoutine())
    expect(sendMessageMock).toHaveBeenCalledWith('p1', 's1', 'Summarize the inbox', 'queue')
    expect(routineApi.recordResult).toHaveBeenCalledWith('r1', 'summary done')
    expect(notifyMock).toHaveBeenCalledTimes(2)
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1)
    expect(String(fsMock.writeFile.mock.calls[0][0])).toContain('/home/user/.pawn/reports/Morning/')
  })

  it('creates a general session for routines without a bound session', async () => {
    useAppStore.setState({
      projects: [],
      activeProjectId: null,
      activeSessionId: null,
      loadedSessions: new Set()
    })
    await runRoutine(makeRoutine({ projectId: '', sessionId: '' }))
    expect(sendMessageMock).toHaveBeenCalled()
    const [projectId, sessionId] = sendMessageMock.mock.calls[0]
    expect(projectId).toBe('__general__')
    expect(sessionId).toBeTruthy()
    // The routine gets rebound to the created session.
    expect(routineApi.update).toHaveBeenCalledWith('r1', { projectId: '__general__', sessionId })
  })
})
