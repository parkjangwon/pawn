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

  describe('revert safety', () => {
    const disk = new Map<string, string>()
    beforeEach(() => {
      disk.clear()
      ;(window as any).api = {
        fs: {
          readFile: vi.fn(async (p: string) => (disk.has(p) ? disk.get(p)! : { error: 'ENOENT' })),
          writeFile: vi.fn(async (p: string, c: string) => {
            disk.set(p, c)
            return { ok: true }
          }),
          delete: vi.fn(async (p: string) => {
            disk.delete(p)
            return { ok: true }
          })
        }
      }
    })

    function agentEdit(path: string, before: string | null, after: string): void {
      useChangeLedger.getState().beginTurn('s1', 'p1', 'turn')
      useChangeLedger.getState().recordChange({ path, before, after, op: before === null ? 'write' : 'edit' })
      useChangeLedger.getState().endTurn()
      disk.set(path, after)
    }

    it('reverts untouched files normally', async () => {
      agentEdit('/p/a.ts', 'orig', 'agent')
      const r = await useChangeLedger.getState().revertTurn()
      expect(r).toMatchObject({ ok: true, reverted: 1 })
      expect(disk.get('/p/a.ts')).toBe('orig')
    })

    it('blocks the whole revert when a file was modified afterwards', async () => {
      useChangeLedger.getState().beginTurn('s1', 'p1', 'turn')
      useChangeLedger.getState().recordChange({ path: '/p/a.ts', before: 'a0', after: 'a1', op: 'edit' })
      useChangeLedger.getState().recordChange({ path: '/p/b.ts', before: 'b0', after: 'b1', op: 'edit' })
      useChangeLedger.getState().endTurn()
      disk.set('/p/a.ts', 'a1')
      disk.set('/p/b.ts', 'b1 + user edit')

      const blocked = await useChangeLedger.getState().revertTurn()
      expect(blocked.ok).toBe(false)
      expect(blocked.error).toBe('conflicts')
      expect(blocked.conflicts).toEqual([{ path: '/p/b.ts', reason: 'modified' }])
      // Nothing was touched.
      expect(disk.get('/p/a.ts')).toBe('a1')
      expect(disk.get('/p/b.ts')).toBe('b1 + user edit')

      const preview = await useChangeLedger.getState().previewRevert()
      expect(preview.safe).toEqual(['/p/a.ts'])
      expect(preview.conflicts).toEqual([{ path: '/p/b.ts', reason: 'modified' }])
    })

    it('can revert only the safe files', async () => {
      useChangeLedger.getState().beginTurn('s1', 'p1', 'turn')
      useChangeLedger.getState().recordChange({ path: '/p/a.ts', before: 'a0', after: 'a1', op: 'edit' })
      useChangeLedger.getState().recordChange({ path: '/p/b.ts', before: 'b0', after: 'b1', op: 'edit' })
      useChangeLedger.getState().endTurn()
      disk.set('/p/a.ts', 'a1')
      disk.set('/p/b.ts', 'mine')
      const r = await useChangeLedger.getState().revertTurn(undefined, { skipConflicts: true })
      expect(r).toMatchObject({ ok: true, reverted: 1, skipped: 1 })
      expect(disk.get('/p/a.ts')).toBe('a0')
      expect(disk.get('/p/b.ts')).toBe('mine')
    })

    it('overwrites modified files only when forced', async () => {
      agentEdit('/p/a.ts', 'orig', 'agent')
      disk.set('/p/a.ts', 'user')
      const r = await useChangeLedger.getState().revertTurn(undefined, { force: true })
      expect(r).toMatchObject({ ok: true, reverted: 1 })
      expect(disk.get('/p/a.ts')).toBe('orig')
    })

    it('flags edited files that were deleted and deletions that were recreated', async () => {
      agentEdit('/p/gone.ts', 'orig', 'agent')
      disk.delete('/p/gone.ts')
      expect((await useChangeLedger.getState().previewRevert()).conflicts).toEqual([
        { path: '/p/gone.ts', reason: 'missing' }
      ])

      useChangeLedger.setState({ turns: [], activeTurnId: null })
      useChangeLedger.getState().beginTurn('s1', 'p1', 'del')
      useChangeLedger.getState().recordChange({ path: '/p/d.ts', before: 'x', after: undefined, op: 'delete' })
      useChangeLedger.getState().endTurn()
      disk.set('/p/d.ts', 'new file')
      expect((await useChangeLedger.getState().previewRevert()).conflicts).toEqual([
        { path: '/p/d.ts', reason: 'recreated' }
      ])
    })

    it('treats an already-removed created file as reverted', async () => {
      agentEdit('/p/new.ts', null, 'created')
      disk.delete('/p/new.ts')
      const r = await useChangeLedger.getState().revertTurn()
      expect(r).toMatchObject({ ok: true, reverted: 1 })
    })

    it('guards single-file revert the same way', async () => {
      agentEdit('/p/a.ts', 'orig', 'agent')
      disk.set('/p/a.ts', 'user')
      const blocked = await useChangeLedger.getState().revertFile('/p/a.ts')
      expect(blocked).toMatchObject({ ok: false, conflict: 'modified' })
      expect(disk.get('/p/a.ts')).toBe('user')
      const forced = await useChangeLedger.getState().revertFile('/p/a.ts', { force: true })
      expect(forced.ok).toBe(true)
      expect(disk.get('/p/a.ts')).toBe('orig')
    })
  })
})
