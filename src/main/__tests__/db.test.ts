import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirHolder = vi.hoisted(() => ({ dir: '' }))

vi.mock('../config', () => ({
  getPawnDir: () => dirHolder.dir
}))

import {
  getDb, closeDb,
  addProject, getAllProjects, updateProjectName, updateProjectPaths, removeProject,
  addSession, getSessionsByProject, updateSessionTitle, updateSessionPath, removeSession,
  addMessage, getMessagesBySession, updateMessageContent, deleteMessage, clearMessages,
  saveTranscript, getTranscript, clearTranscript,
  addUsage, getUsageBySession, getUsageSummary, loadFullState,
  addRoutine, getAllRoutines, updateRoutine, removeRoutine, setRoutineRunState,
  saveTurnCheckpoint, listRunningTurnCheckpoints, clearTurnCheckpoint, getTurnCheckpoint,
  saveChangeLedgerTurn, listChangeLedgerTurns, deleteChangeLedgerForSession
} from '../db'

beforeAll(() => {
  dirHolder.dir = mkdtempSync(join(tmpdir(), 'pawn-db-test-'))
})

beforeEach(() => {
  closeDb()
  rmSync(join(dirHolder.dir, 'pawn.db'), { force: true })
  rmSync(join(dirHolder.dir, 'pawn.db-wal'), { force: true })
  rmSync(join(dirHolder.dir, 'pawn.db-shm'), { force: true })
})

afterAll(() => {
  closeDb()
  rmSync(dirHolder.dir, { recursive: true, force: true })
})

describe('projects', () => {
  it('creates, lists, updates and removes projects', () => {
    addProject('proj-1', 'Alpha', '/a')
    addProject('proj-2', 'Beta', '/b')

    const all = getAllProjects()
    expect(all.map((p) => p.id).sort()).toEqual(['proj-1', 'proj-2'])
    expect(all[0].createdAt).toBeGreaterThan(0)

    updateProjectName('proj-1', 'Alpha Renamed')
    updateProjectPaths('proj-1', JSON.stringify(['/a', '/a2']))
    const updated = getAllProjects().find((p) => p.id === 'proj-1')
    expect(updated?.name).toBe('Alpha Renamed')
    expect(updated?.path).toBe('["/a","/a2"]')

    removeProject('proj-2')
    expect(getAllProjects()).toHaveLength(1)
  })
})

describe('sessions', () => {
  it('lists sessions newest-first and cascades deletes', () => {
    addProject('proj', 'P', '/p')
    addSession('s1', 'proj', 'First', '/p')
    addSession('s2', 'proj', 'Second', '/p')
    addMessage('m1', 's1', 'user', 'hello')

    const sessions = getSessionsByProject('proj')
    expect(sessions.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    expect(sessions[0].createdAt).toBeGreaterThanOrEqual(sessions[1].createdAt)

    updateSessionTitle('s2', 'Second Renamed')
    updateSessionPath('s2', '/p/sub')
    expect(getSessionsByProject('proj').find((s) => s.id === 's2')?.title).toBe('Second Renamed')

    removeSession('s1')
    expect(getMessagesBySession('s1')).toHaveLength(0)

    removeProject('proj')
    expect(getSessionsByProject('proj')).toHaveLength(0)
  })
})

describe('messages', () => {
  it('stores, updates, deletes and clears messages', () => {
    addProject('proj', 'P', '/p')
    addSession('s', 'proj', 'S', '/p')

    addMessage('m1', 's', 'user', 'first')
    addMessage('m2', 's', 'assistant', 'second')
    expect(getMessagesBySession('s').map((m) => m.content)).toEqual(['first', 'second'])

    updateMessageContent('m1', 'first-edited')
    expect(getMessagesBySession('s')[0].content).toBe('first-edited')

    deleteMessage('m2')
    expect(getMessagesBySession('s')).toHaveLength(1)

    saveTranscript('s', '{"version":2,"entries":[]}')
    clearMessages('s')
    expect(getMessagesBySession('s')).toHaveLength(0)
    expect(getTranscript('s')).toBeNull()
  })
})

describe('transcripts', () => {
  it('upserts and clears transcripts', () => {
    addProject('proj', 'P', '/p')
    addSession('s', 'proj', 'S', '/p')

    expect(getTranscript('s')).toBeNull()
    saveTranscript('s', '{"version":2,"entries":[]}')
    expect(getTranscript('s')).toBe('{"version":2,"entries":[]}')
    saveTranscript('s', '{"version":2,"entries":[],"warmFor":"a:b"}')
    expect(getTranscript('s')).toContain('warmFor')
    clearTranscript('s')
    expect(getTranscript('s')).toBeNull()
  })
})

describe('usage', () => {
  it('records rows and summarizes by provider/model', () => {
    addProject('proj', 'P', '/p')
    addSession('s', 'proj', 'S', '/p')
    const now = Math.floor(Date.now() / 1000)

    addUsage({ id: 'u1', sessionId: 's', providerId: 'openai', modelId: 'gpt-4o', inputTokens: 1000, outputTokens: 200, cacheReadTokens: 500, cacheWriteTokens: 0, cost: 0.02 })
    addUsage({ id: 'u2', sessionId: 's', providerId: 'openai', modelId: 'gpt-4o', inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.01 })
    addUsage({ id: 'u3', sessionId: 's', providerId: 'anthropic', modelId: 'opus', inputTokens: 500, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 2000, cost: 0.05 })

    const bySession = getUsageBySession('s')
    expect(bySession).toHaveLength(3)
    expect(bySession[0].cost).toBe(0.02)

    const summary = getUsageSummary(now)
    expect(summary).toHaveLength(2)
    const openai = summary.find((r) => r.providerId === 'openai')
    expect(openai?.calls).toBe(2)
    expect(openai?.inputTokens).toBe(2000)
    expect(openai?.cacheReadTokens).toBe(500)
    // Ordered by cost DESC: anthropic (0.05) first.
    expect(summary[0].providerId).toBe('anthropic')

    expect(getUsageSummary(now + 1000)).toHaveLength(0)
  })
})

describe('loadFullState', () => {
  it('returns projects with sessions', () => {
    addProject('proj', 'P', '/p')
    addSession('s1', 'proj', 'S1', '/p')
    addSession('s2', 'proj', 'S2', '/p')
    const state = loadFullState()
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0].sessions.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('creates the schema on first access', () => {
    const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    for (const expected of ['projects', 'sessions', 'messages', 'transcripts', 'usage']) {
      expect(names).toContain(expected)
    }
  })
})

describe('routines', () => {
  it('creates, updates, toggles and removes routines', () => {
    addRoutine({
      id: 'r1', name: 'Morning', schedule: '{"type":"daily","hour":9,"minute":0}',
      prompt: 'Summarize the inbox', projectId: '', sessionId: '', nextRunAt: 1000
    })
    const rows = getAllRoutines()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Morning')
    expect(rows[0].enabled).toBe(true)
    expect(rows[0].schedule).toContain('daily')

    updateRoutine('r1', { name: 'Evening', enabled: false, nextRunAt: 2000 })
    const updated = getAllRoutines()[0]
    expect(updated.name).toBe('Evening')
    expect(updated.enabled).toBe(false)
    expect(updated.nextRunAt).toBe(2000)

    setRoutineRunState('r1', 3000, 2500, 'done')
    const ran = getAllRoutines()[0]
    expect(ran.nextRunAt).toBe(3000)
    expect(ran.lastRunAt).toBe(2500)
    expect(ran.lastResult).toBe('done')

    removeRoutine('r1')
    expect(getAllRoutines()).toHaveLength(0)
  })

  it('keeps partial updates intact', () => {
    addRoutine({
      id: 'r2', name: 'N', schedule: '{"type":"interval","minutes":60}',
      prompt: 'P', projectId: 'proj', sessionId: 's', nextRunAt: 100
    })
    updateRoutine('r2', { prompt: 'P2' })
    const row = getAllRoutines()[0]
    expect(row.name).toBe('N')
    expect(row.projectId).toBe('proj')
    expect(row.sessionId).toBe('s')
    expect(row.prompt).toBe('P2')
    removeRoutine('r2')
  })
})

describe('turn checkpoints', () => {
  it('saves, lists, and clears running checkpoints', () => {
    addProject('proj', 'P', '/p')
    addSession('s1', 'proj', 'S', '/p')
    saveTurnCheckpoint('s1', 'proj', 'running', JSON.stringify({ version: 1, sessionId: 's1' }))
    const listed = listRunningTurnCheckpoints()
    expect(listed).toHaveLength(1)
    expect(listed[0].sessionId).toBe('s1')
    expect(getTurnCheckpoint('s1')?.status).toBe('running')
    clearTurnCheckpoint('s1', 'completed')
    expect(listRunningTurnCheckpoints()).toHaveLength(0)
    expect(getTurnCheckpoint('s1')?.status).toBe('completed')
  })
})

describe('change ledger durability', () => {
  it('persists and lists ledger turns', () => {
    addProject('proj', 'P', '/p')
    addSession('s1', 'proj', 'S', '/p')
    saveChangeLedgerTurn({
      id: 'turn-1',
      sessionId: 's1',
      projectId: 'proj',
      createdAt: Date.now(),
      label: 'edit',
      json: JSON.stringify({ id: 'turn-1', changes: [] })
    })
    const list = listChangeLedgerTurns(10)
    expect(list.some((r) => r.id === 'turn-1')).toBe(true)
    deleteChangeLedgerForSession('s1')
    expect(listChangeLedgerTurns(10).some((r) => r.id === 'turn-1')).toBe(false)
  })
})
