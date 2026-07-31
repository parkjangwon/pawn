import { describe, it, expect } from 'vitest'
import { formatToolMessageContent, DIFF_TEXT_CAP } from '../toolMessage'
import { parseDiffMarker, stripDiffMarker } from '../../utils/diffMarker'

describe('formatToolMessageContent', () => {
  it('builds the status line and truncates tool output to 500 chars', () => {
    const out = formatToolMessageContent('read_file', false, 'x'.repeat(2000))
    expect(out.startsWith('[Tool: read_file] OK\n')).toBe(true)
    expect(out.length).toBe('[Tool: read_file] OK\n'.length + 500)
  })

  it('marks errors', () => {
    expect(formatToolMessageContent('shell_exec', true, 'no such file').startsWith('[Tool: shell_exec] ERROR\n')).toBe(true)
  })

  it('embeds a parseable diff marker with full text capped at DIFF_TEXT_CAP', () => {
    const oldText = 'old\ncontent'
    const newText = 'new\ncontent'
    const out = formatToolMessageContent('edit_file', false, 'edited 1 line', { filename: 'a.ts', oldText, newText })
    const diff = parseDiffMarker(out)
    expect(diff).toEqual({ filename: 'a.ts', oldText, newText })
    expect(stripDiffMarker(out)).toBe('[Tool: edit_file] OK\nedited 1 line')
  })

  it('caps oversized diff text', () => {
    const out = formatToolMessageContent('write_file', false, 'wrote', {
      filename: 'big.ts',
      oldText: '',
      newText: 'z'.repeat(DIFF_TEXT_CAP + 1000)
    })
    const diff = parseDiffMarker(out)
    expect(diff?.newText.length).toBe(DIFF_TEXT_CAP)
  })

  it('omits the marker when there is no diff', () => {
    const out = formatToolMessageContent('grep_search', false, 'no matches')
    expect(out).not.toContain('__DIFF__:')
    expect(parseDiffMarker(out)).toBeNull()
  })
})
