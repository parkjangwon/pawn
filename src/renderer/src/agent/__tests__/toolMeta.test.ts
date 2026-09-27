import { describe, it, expect } from 'vitest'
import {
  aggregateToolMeta,
  buildToolMeta,
  displayTarget,
  formatToolDuration,
  lineDelta,
  parseToolMeta,
  primaryTarget,
  serializeToolMeta,
  toolKind
} from '../toolMeta'

describe('buildToolMeta', () => {
  it('records name, status, target, duration, and line stats for edits', () => {
    const meta = buildToolMeta(
      { id: '1', name: 'edit_file', arguments: { path: '/p/src/router.ts', old_string: 'a', new_string: 'b' } },
      {
        toolCallId: '1',
        content: 'File edited',
        diffData: { filename: 'router.ts', path: '/p/src/router.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc\nd' }
      },
      1234.6
    )
    expect(meta).toEqual({
      v: 1,
      name: 'edit_file',
      status: 'ok',
      durationMs: 1235,
      target: '/p/src/router.ts',
      path: '/p/src/router.ts',
      added: 2,
      removed: 1,
      bytes: 11
    })
  })

  it('marks errors and skips line stats on failed edits', () => {
    const meta = buildToolMeta(
      { id: '1', name: 'shell_exec', arguments: { command: 'npm   test\n --silent' } },
      { toolCallId: '1', content: 'boom', isError: true }
    )
    expect(meta.status).toBe('error')
    expect(meta.target).toBe('npm test --silent')
    expect(meta.added).toBeUndefined()
  })
})

describe('helpers', () => {
  it('picks a primary target from common argument names', () => {
    expect(primaryTarget({ query: 'useStore' })).toBe('useStore')
    expect(primaryTarget({ groups: ['browser', 'github'] })).toBe('browser, github')
    expect(primaryTarget({ tasks: [1, 2, 3] })).toBe('3 tasks')
    expect(primaryTarget({ x: 1 })).toBeUndefined()
    expect(primaryTarget({ command: 'x'.repeat(500) })!.length).toBeLessThanOrEqual(160)
  })

  it('computes line deltas for create / delete / edit', () => {
    expect(lineDelta('', 'a\nb')).toEqual({ added: 2, removed: 0 })
    expect(lineDelta('a\nb\nc', '')).toEqual({ added: 0, removed: 3 })
    expect(lineDelta('same', 'same')).toEqual({ added: 0, removed: 0 })
    // A trailing newline ends the last line; it is not an extra line.
    expect(lineDelta('', 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 })
    expect(lineDelta('a\nb\n', '')).toEqual({ added: 0, removed: 2 })
  })

  it('shortens paths for display but leaves commands alone', () => {
    expect(displayTarget({ name: 'edit_file', path: '/Users/me/p/src/agent/router.ts' })).toBe('agent/router.ts')
    expect(displayTarget({ name: 'shell_exec', target: 'npm run test -- src/a.ts' })).toBe('npm run test -- src/a.ts')
    expect(displayTarget({ name: 'web_fetch', target: 'https://x.dev/a/b' })).toBe('https://x.dev/a/b')
  })

  it('formats durations compactly', () => {
    expect(formatToolDuration(40)).toBe('40ms')
    expect(formatToolDuration(4200)).toBe('4.2s')
    expect(formatToolDuration(42_000)).toBe('42s')
    expect(formatToolDuration(125_000)).toBe('2m 5s')
    expect(formatToolDuration(undefined)).toBeUndefined()
  })

  it('round-trips through JSON and rejects malformed input', () => {
    const meta = buildToolMeta({ id: '1', name: 'read_file', arguments: { path: '/a' } }, { toolCallId: '1', content: 'x' }, 5)
    expect(parseToolMeta(serializeToolMeta(meta))).toEqual(meta)
    expect(parseToolMeta('not json')).toBeUndefined()
    expect(parseToolMeta('{"name":"x","status":"weird"}')).toBeUndefined()
    expect(parseToolMeta('')).toBeUndefined()
  })

  it('classifies tools and aggregates batches', () => {
    expect(toolKind('write_file', { added: 10, removed: 0 })).toBe('create')
    expect(toolKind('write_file', { added: 2, removed: 3 })).toBe('edit')
    expect(toolKind('run_checks')).toBe('shell')
    const stats = aggregateToolMeta([
      { v: 1, name: 'edit_file', status: 'ok', path: '/a', added: 3, removed: 1, durationMs: 100 },
      { v: 1, name: 'edit_file', status: 'ok', path: '/a', added: 1, removed: 0, durationMs: 50 },
      { v: 1, name: 'write_file', status: 'ok', path: '/b', added: 10, removed: 0 },
      { v: 1, name: 'shell_exec', status: 'error', durationMs: 2000 },
      undefined
    ])
    expect(stats).toMatchObject({ total: 4, errors: 1, filesChanged: 2, added: 14, removed: 1, durationMs: 2150 })
    expect(stats.byKind).toEqual({ edit: 2, create: 1, shell: 1 })
  })
})
