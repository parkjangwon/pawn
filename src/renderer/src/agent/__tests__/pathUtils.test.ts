import { describe, it, expect } from 'vitest'
import { resolveToolPath, countOccurrences, formatFileRead } from '../pathUtils'

describe('resolveToolPath', () => {
  it('keeps absolute paths', () => {
    expect(resolveToolPath('/abs/a.ts', '/proj')).toBe('/abs/a.ts')
    expect(resolveToolPath('C:\\Users\\x', '/proj')).toBe('C:\\Users\\x')
  })

  it('joins relative paths to the project root', () => {
    expect(resolveToolPath('src/a.ts', '/home/proj')).toBe('/home/proj/src/a.ts')
    expect(resolveToolPath('./src/a.ts', '/home/proj/')).toBe('/home/proj/src/a.ts')
  })

  it('falls back when empty', () => {
    expect(resolveToolPath('', '/home/proj')).toBe('/home/proj')
    expect(resolveToolPath(undefined, '/home/proj')).toBe('/home/proj')
  })
})

describe('countOccurrences', () => {
  it('counts non-overlapping matches', () => {
    expect(countOccurrences('aaa', 'a')).toBe(3)
    expect(countOccurrences('ab ab ab', 'ab')).toBe(3)
    expect(countOccurrences('hello', '')).toBe(0)
  })
})

describe('formatFileRead', () => {
  it('returns full text for small files without window opts', () => {
    expect(formatFileRead('hello\nworld')).toBe('hello\nworld')
  })

  it('pages with offset/limit and line numbers', () => {
    const text = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n')
    const out = formatFileRead(text, { offset: 3, limit: 2 })
    expect(out).toContain('lines 3-4 of 10')
    expect(out).toContain('     3|line3')
    expect(out).toContain('     4|line4')
    expect(out).toContain('more lines')
  })
})
