import { describe, it, expect } from 'vitest'
import { parseDiffMarker, stripDiffMarker, DIFF_MARKER } from '../diffMarker'

const jsonMarker = (filename: string, oldText: string, newText: string): string =>
  `${DIFF_MARKER}${JSON.stringify({ filename, oldText, newText })}`

describe('parseDiffMarker', () => {
  it('parses the JSON marker anywhere in the content', () => {
    const content = `[Tool: write_file] OK\nwrote 5 chars\n${jsonMarker('a.ts', 'old', 'new')}`
    expect(parseDiffMarker(content)).toEqual({ filename: 'a.ts', oldText: 'old', newText: 'new' })
  })

  it('handles multiline diff text', () => {
    const content = jsonMarker('multi.ts', 'line1\nline2', 'line1\nline2\nline3')
    expect(parseDiffMarker(content)?.newText).toBe('line1\nline2\nline3')
  })

  it('parses the legacy block for older persisted messages', () => {
    const content = '[Tool: edit_file] OK\nx\n<<<DIFF:old.ts>>>\n--- old\nabc\n+++ new\nabd\n<<<END>>>'
    expect(parseDiffMarker(content)).toEqual({ filename: 'old.ts', oldText: 'abc', newText: 'abd' })
  })

  it('returns null for malformed or missing markers', () => {
    expect(parseDiffMarker('[Tool: read_file] OK\nnothing here')).toBeNull()
    expect(parseDiffMarker(`[Tool: x] OK\n${DIFF_MARKER}{not-json`)).toBeNull()
    expect(parseDiffMarker(`${DIFF_MARKER}{"filename":123}`)).toBeNull()
  })
})

describe('stripDiffMarker', () => {
  it('removes the JSON marker line', () => {
    const content = `[Tool: write_file] OK\nwrote\n${jsonMarker('a.ts', 'o', 'n')}`
    expect(stripDiffMarker(content)).toBe('[Tool: write_file] OK\nwrote')
  })

  it('removes the legacy block', () => {
    const content = '[Tool: x] OK\n<<<DIFF:f.ts>>>\n--- old\na\n+++ new\nb\n<<<END>>>'
    expect(stripDiffMarker(content)).toBe('[Tool: x] OK')
  })

  it('returns the content untouched without a marker', () => {
    const content = '[Tool: x] OK\nplain'
    expect(stripDiffMarker(content)).toBe(content)
  })
})
