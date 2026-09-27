// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { recordCommandCreatedFiles, takeFileBaseline } from '../commandFiles'
import { useChangeLedger } from '../../stores/changeLedger'

let untracked: string[]
beforeEach(() => {
  untracked = ['old.txt']
  useChangeLedger.setState({ turns: [], activeTurnId: null } as any)
  useChangeLedger.getState().beginTurn('s1', 'p1', 'make a chart')
  ;(window as any).api = {
    shell: {
      execFile: vi.fn(async (file: string, args: string[]) => {
        if (file === 'git' && args[0] === 'status') return { exitCode: 0, stdout: untracked.map((p) => `?? ${p}\0`).join(''), stderr: '' }
        return { exitCode: 1, stdout: '', stderr: '' }
      })
    },
    fs: {
      stat: vi.fn(async (p: string) => ({ size: p.endsWith('.png') ? 5000 : 10, isFile: true, isDirectory: false, mtime: 0 })),
      readFile: vi.fn(async () => '<svg/>')
    }
  }
})

describe('command-created files', () => {
  it('records new untracked files (text with content, binary without), once, marked byCommand', async () => {
    const base = await takeFileBaseline('/proj')
    expect(base?.kind).toBe('git')
    // A file tool already recorded one of them.
    useChangeLedger.getState().recordChange({ path: '/proj/charts/sales.svg', before: null, after: '<svg/>', op: 'write' })
    untracked = ['old.txt', 'charts/sales.svg', 'charts/sales.png']
    expect(await recordCommandCreatedFiles(base)).toEqual(['/proj/charts/sales.png'])
    const changes = useChangeLedger.getState().turns.at(-1)!.changes
    expect(changes.map((c) => [c.path, c.byCommand ?? false, c.after === undefined])).toEqual([
      ['/proj/charts/sales.svg', false, false],
      ['/proj/charts/sales.png', true, true]
    ])
    // Not reported twice.
    expect(await recordCommandCreatedFiles(base)).toEqual([])
    untracked.push('notes.md')
    expect(await recordCommandCreatedFiles(base)).toEqual(['/proj/notes.md'])
    expect(useChangeLedger.getState().turns.at(-1)!.changes.at(-1)).toMatchObject({ after: '<svg/>', byCommand: true })
  })
})
