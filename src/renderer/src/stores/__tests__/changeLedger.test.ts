/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChangeLedger } from '../changeLedger'

describe('changeLedger', () => {
  beforeEach(() => {
    useChangeLedger.setState({ turns: [], activeTurnId: null })
    ;(window as any).api = {
      fs: {
        writeFile: vi.fn().mockResolvedValue({ ok: true }),
        delete: vi.fn().mockResolvedValue({ ok: true })
      }
    }
  })

  it('records and reverts a created file', async () => {
    useChangeLedger.getState().beginTurn('s1', 'p1', 'create')
    useChangeLedger.getState().recordChange({
      path: '/proj/a.ts',
      before: null,
      after: 'hello',
      op: 'write'
    })
    useChangeLedger.getState().endTurn()
    const r = await useChangeLedger.getState().revertTurn()
    expect(r.ok).toBe(true)
    expect(r.reverted).toBe(1)
    expect((window as any).api.fs.delete).toHaveBeenCalledWith('/proj/a.ts')
  })

  it('keeps earliest before across multiple edits', () => {
    useChangeLedger.getState().beginTurn('s1', 'p1', 'edit')
    useChangeLedger.getState().recordChange({
      path: '/proj/a.ts',
      before: 'v1',
      after: 'v2',
      op: 'edit'
    })
    useChangeLedger.getState().recordChange({
      path: '/proj/a.ts',
      before: 'v2',
      after: 'v3',
      op: 'edit'
    })
    const turn = useChangeLedger.getState().latestTurn('s1')
    expect(turn?.changes).toHaveLength(1)
    expect(turn?.changes[0].before).toBe('v1')
    expect(turn?.changes[0].after).toBe('v3')
  })
})
