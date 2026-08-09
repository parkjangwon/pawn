/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  saveTurnCheckpoint,
  clearTurnCheckpoint,
  listRunningTurnCheckpoints,
  TURN_CHECKPOINT_VERSION
} from '../turnCheckpoint'
import { __flushDbWriteQueueForTests, __resetDbWriteQueueForTests } from '../../utils/dbWriteQueue'

describe('turnCheckpoint helpers', () => {
  const saveMock = vi.fn().mockResolvedValue({ ok: true })
  const clearMock = vi.fn().mockResolvedValue({ ok: true })
  const listMock = vi.fn().mockResolvedValue([])

  beforeEach(() => {
    __resetDbWriteQueueForTests()
    saveMock.mockClear()
    clearMock.mockClear()
    listMock.mockClear()
    ;(window as any).api = {
      db: {
        saveTurnCheckpoint: saveMock,
        clearTurnCheckpoint: clearMock,
        listRunningTurnCheckpoints: listMock
      }
    }
  })

  it('enqueues a save with versioned payload', async () => {
    saveTurnCheckpoint({
      version: TURN_CHECKPOINT_VERSION,
      projectId: 'p',
      sessionId: 's',
      userContent: 'hi',
      entries: [{ role: 'user', content: 'hi' }],
      round: 1,
      consecutiveToolErrors: 0,
      emptyResponses: 0,
      complexity: 'simple',
      turnHadCodeEdits: false,
      turnRanChecks: false,
      autoVerifyDone: false,
      userMessageAppended: true,
      lastActivity: Date.now()
    })
    await __flushDbWriteQueueForTests()
    expect(saveMock).toHaveBeenCalledTimes(1)
    const [sessionId, projectId, status, json] = saveMock.mock.calls[0]
    expect(sessionId).toBe('s')
    expect(projectId).toBe('p')
    expect(status).toBe('running')
    expect(JSON.parse(json).version).toBe(TURN_CHECKPOINT_VERSION)
  })

  it('lists only valid recent checkpoints', async () => {
    listMock.mockResolvedValue([
      {
        sessionId: 's1',
        projectId: 'p',
        status: 'running',
        json: JSON.stringify({
          version: TURN_CHECKPOINT_VERSION,
          projectId: 'p',
          sessionId: 's1',
          userContent: 'x',
          entries: [],
          round: 0,
          consecutiveToolErrors: 0,
          emptyResponses: 0,
          complexity: 'simple',
          turnHadCodeEdits: false,
          turnRanChecks: false,
          autoVerifyDone: false,
          userMessageAppended: true,
          lastActivity: Date.now()
        }),
        updatedAt: Date.now()
      },
      {
        sessionId: 'old',
        projectId: 'p',
        status: 'running',
        json: JSON.stringify({
          version: TURN_CHECKPOINT_VERSION,
          projectId: 'p',
          sessionId: 'old',
          userContent: 'old',
          entries: [],
          round: 0,
          consecutiveToolErrors: 0,
          emptyResponses: 0,
          complexity: 'simple',
          turnHadCodeEdits: false,
          turnRanChecks: false,
          autoVerifyDone: false,
          userMessageAppended: true,
          lastActivity: Date.now() - 48 * 60 * 60 * 1000
        }),
        updatedAt: Date.now()
      }
    ])
    const cps = await listRunningTurnCheckpoints()
    expect(cps.map((c) => c.sessionId)).toEqual(['s1'])
  })

  it('clears checkpoint with status', async () => {
    clearTurnCheckpoint('s', 'aborted')
    await __flushDbWriteQueueForTests()
    expect(clearMock).toHaveBeenCalledWith('s', 'aborted')
  })
})
