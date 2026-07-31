import { describe, it, expect } from 'vitest'
import { computeDiff, computeDiffHunks, formatUnifiedDiff } from '../diff'

describe('computeDiff', () => {
  it('marks identical lines as same with line numbers', () => {
    const r = computeDiff('a\nb\nc', 'a\nb\nc')
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
    expect(r.lines).toEqual([
      { type: 'same', oldLine: 1, newLine: 1, text: 'a' },
      { type: 'same', oldLine: 2, newLine: 2, text: 'b' },
      { type: 'same', oldLine: 3, newLine: 3, text: 'c' }
    ])
  })

  it('detects appended lines as additions', () => {
    const r = computeDiff('a', 'a\nb')
    expect(r.added).toBe(1)
    expect(r.lines[1]).toEqual({ type: 'add', oldLine: null, newLine: 2, text: 'b' })
  })

  it('detects removed lines', () => {
    const r = computeDiff('a\nb', 'a')
    expect(r.removed).toBe(1)
    expect(r.lines[1]).toEqual({ type: 'remove', oldLine: 2, newLine: null, text: 'b' })
  })

  it('represents a modified line as remove + add', () => {
    const r = computeDiff('one\ntwo\nthree', 'one\nTWO\nthree')
    expect(r.removed).toBe(1)
    expect(r.added).toBe(1)
    const types = r.lines.map((l) => l.type)
    expect(types).toContain('remove')
    expect(types).toContain('add')
  })

  it('handles empty inputs', () => {
    expect(computeDiff('', '')).toEqual({ lines: [], added: 0, removed: 0 })
    expect(computeDiff('', 'x').added).toBe(1)
    expect(computeDiff('x', '').removed).toBe(1)
  })

  it('finds the longest common subsequence rather than a naive prefix', () => {
    const r = computeDiff('keep\na\nb\nc\nkeep2', 'keep\ndrop\nc\nkeep2')
    // The common 'c' and 'keep2' lines must be marked same.
    const sameTexts = r.lines.filter((l) => l.type === 'same').map((l) => l.text)
    expect(sameTexts).toEqual(['keep', 'c', 'keep2'])
  })
})

describe('formatUnifiedDiff', () => {
  it('prefixes lines with +, - and space', () => {
    const out = formatUnifiedDiff('a\nb', 'a\nc')
    expect(out).toBe('  a\n- b\n+ c\n')
  })
})

describe('computeDiffHunks', () => {
  it('returns the same diff result', () => {
    expect(computeDiffHunks('a\nb', 'a\nc')).toEqual(computeDiff('a\nb', 'a\nc'))
  })
})
