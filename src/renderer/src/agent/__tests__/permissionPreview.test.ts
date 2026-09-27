import { describe, it, expect } from 'vitest'
import { buildPermissionPreview } from '../permissionPreview'

describe('permission preview', () => {
  it('shows file writes as the real text with a line count', () => {
    const p = buildPermissionPreview('write_file', { path: 'src/utils/format.js', content: '/**\n * Helpers\n */\nexport const a = 1\n' }, { path: '/proj/src/utils/format.js' })
    expect(p).toMatchObject({ kind: 'file', target: '/proj/src/utils/format.js', summary: '4 lines' })
    expect(p.lines.map((l) => l.text)).toEqual(['/**', ' * Helpers', ' */', 'export const a = 1'])
    expect(JSON.stringify(p)).not.toContain('\\\\n')
  })

  it('shows edits as removed / added lines and caps long content', () => {
    const e = buildPermissionPreview('edit_file', { path: 'a.ts', old_string: 'return a + b', new_string: 'return a + b + 0\n// done', replace_all: true })
    expect(e.kind).toBe('edit')
    expect(e.summary).toBe('-1 +2 · all occurrences')
    expect(e.lines).toEqual([{ text: 'return a + b', mark: '-' }, { text: 'return a + b + 0', mark: '+' }, { text: '// done', mark: '+' }])
    const big = buildPermissionPreview('write_file', { path: 'x', content: Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n') })
    expect(big.lines).toHaveLength(40)
    expect(big.truncated).toBe(60)
  })

  it('shows native text-editor calls, patches and commands naturally', () => {
    expect(buildPermissionPreview('write_file', { command: 'create', path: 'n.py', file_text: 'print(1)' }).kind).toBe('file')
    const ins = buildPermissionPreview('edit_file', { command: 'insert', path: 'n.py', insert_line: 3, insert_text: 'x = 1' })
    expect(ins.summary).toBe('-0 +1 · after line 3')
    const patch = buildPermissionPreview('apply_patch', { input: '*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** Add File: b.ts\n+hi\n*** End Patch' })
    expect(patch.summary).toBe('U a.ts, A b.ts')
    expect(patch.lines.filter((l) => l.mark === '+').map((l) => l.text)).toEqual(['+new', '+hi'])
    const cmd = buildPermissionPreview('shell_exec', { command: 'npm test -- --watch=false', background: true })
    expect(cmd).toMatchObject({ kind: 'command', summary: 'background', lines: [{ text: 'npm test -- --watch=false' }] })
    const other = buildPermissionPreview('web_fetch', { url: 'https://x.dev', max_chars: 5000 })
    expect(other.lines.map((l) => l.text)).toEqual(['url: https://x.dev', 'max_chars: 5000'])
  })
})
