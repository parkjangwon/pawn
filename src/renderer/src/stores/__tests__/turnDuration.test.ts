// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore, type Message } from '../app'
import { recordTurnDuration } from '../chatLoop'
import { __flushDbWriteQueueForTests, __resetDbWriteQueueForTests } from '../../utils/dbWriteQueue'

const updateMessageMeta = vi.fn().mockResolvedValue({ ok: true })

const msg = (id: string, role: Message['role']): Message => ({ id, role, content: id, createdAt: 1 })

function seed(messages: Message[]): void {
  useAppStore.setState({
    projects: [{ id: 'p', name: 'P', paths: [], sessions: [{ id: 's', title: 'S', path: '', createdAt: 1, messages }] }],
    activeProjectId: 'p',
    activeSessionId: 's'
  })
}

function messagesNow(): Message[] {
  return useAppStore.getState().projects[0].sessions[0].messages
}

beforeEach(() => {
  __resetDbWriteQueueForTests()
  updateMessageMeta.mockClear()
  ;(window as any).api = { db: { updateMessageMeta } }
})

describe('turn duration ("worked for")', () => {
  it('tags the last surviving assistant bubble of the turn and persists it', async () => {
    // a2 was an empty tool-round placeholder that got removed.
    seed([msg('u', 'user'), msg('a1', 'assistant'), msg('t', 'system'), msg('a3', 'assistant')])
    recordTurnDuration('p', 's', ['a1', 'a2', 'a3'], 42_400)
    const byId = new Map(messagesNow().map((m) => [m.id, m]))
    expect(byId.get('a3')?.durationMs).toBe(42_400)
    expect(byId.get('a1')?.durationMs).toBeUndefined()
    await __flushDbWriteQueueForTests()
    expect(updateMessageMeta).toHaveBeenCalledWith('a3', { durationMs: 42_400 })
  })

  it('walks back past removed bubbles', () => {
    seed([msg('u', 'user'), msg('a1', 'assistant')])
    recordTurnDuration('p', 's', ['a1', 'gone'], 1000)
    expect(messagesNow().find((m) => m.id === 'a1')?.durationMs).toBe(1000)
  })

  it('does nothing without assistant bubbles or with a non-positive duration', () => {
    seed([msg('u', 'user'), msg('a1', 'assistant')])
    recordTurnDuration('p', 's', [], 1000)
    recordTurnDuration('p', 's', ['a1'], 0)
    expect(messagesNow().find((m) => m.id === 'a1')?.durationMs).toBeUndefined()
    expect(updateMessageMeta).not.toHaveBeenCalled()
  })
})
