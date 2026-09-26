import { describe, it, expect } from 'vitest'
import { fuzzyMatchRanges, mergeRanges, scoreFields, scoreFuzzy } from '../fuzzyMatch'

describe('scoreFuzzy', () => {
  it('ranks prefix < substring < subsequence', () => {
    const prefix = scoreFuzzy('Settings', 'set')!
    const substring = scoreFuzzy('Open settings', 'set')!
    const subsequence = scoreFuzzy('Toggle sidebar', 'tsb')!
    expect(prefix).toBeLessThan(substring)
    expect(substring).toBeLessThan(subsequence)
  })

  it('is case-insensitive', () => {
    expect(scoreFuzzy('New Chat', 'new chat')).toBe(0)
  })

  it('returns null when characters are missing or out of order', () => {
    expect(scoreFuzzy('Settings', 'xyz')).toBeNull()
    expect(scoreFuzzy('abc', 'cba')).toBeNull()
  })

  it('only matches CJK queries by prefix/substring', () => {
    expect(scoreFuzzy('새 채팅 시작', '채팅')).not.toBeNull()
    // "새시" is a subsequence, but ideographic/syllable subsequences are too loose.
    expect(scoreFuzzy('새 채팅 시작', '새시')).toBeNull()
    expect(scoreFuzzy('設定を開く', '設定')).not.toBeNull()
  })

  it('treats an empty query as a match', () => {
    expect(scoreFuzzy('anything', '  ')).toBe(0)
  })
})

describe('scoreFields', () => {
  const fields = (label: string, description: string) => [
    { text: label, weight: 0 },
    { text: description, weight: 60 }
  ]

  it('requires every term to match some field', () => {
    expect(scoreFields(fields('Toggle theme', 'Switch light/dark'), 'toggle dark')).not.toBeNull()
    expect(scoreFields(fields('Toggle theme', 'Switch light/dark'), 'toggle zzz')).toBeNull()
  })

  it('prefers label matches over description matches', () => {
    const inLabel = scoreFields(fields('Terminal', 'Bottom panel'), 'term')!
    const inDesc = scoreFields(fields('Bottom panel', 'Terminal'), 'term')!
    expect(inLabel).toBeLessThan(inDesc)
  })
})

describe('fuzzyMatchRanges', () => {
  it('highlights substring matches', () => {
    expect(fuzzyMatchRanges('Open settings', 'set')).toEqual([{ start: 5, end: 8 }])
  })

  it('highlights individual characters for subsequence matches', () => {
    // T(0) oggle s(7)ide b(11)ar
    expect(fuzzyMatchRanges('Toggle sidebar', 'tsb')).toEqual([
      { start: 0, end: 1 },
      { start: 7, end: 8 },
      { start: 11, end: 12 }
    ])
  })

  it('merges overlapping and adjacent term ranges', () => {
    expect(fuzzyMatchRanges('abcdef', 'abc cde')).toEqual([{ start: 0, end: 5 }])
  })

  it('returns nothing for an empty query or a non-match', () => {
    expect(fuzzyMatchRanges('abc', '')).toEqual([])
    expect(fuzzyMatchRanges('abc', 'z')).toEqual([])
  })
})

describe('mergeRanges', () => {
  it('sorts, merges, and drops empty ranges', () => {
    expect(
      mergeRanges([
        { start: 6, end: 8 },
        { start: 0, end: 2 },
        { start: 1, end: 4 },
        { start: 5, end: 5 }
      ])
    ).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 8 }
    ])
  })
})
