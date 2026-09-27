import { describe, it, expect } from 'vitest'
import { formatDuration, formatMessageTime, normalizeTimestampMs } from '../messageTime'

const units = {
  d: (n: number) => `${n}d`,
  h: (n: number) => `${n}h`,
  m: (n: number) => `${n}m`,
  s: (n: number) => `${n}s`
}

describe('normalizeTimestampMs', () => {
  it('treats small values as unix seconds (SQLite unixepoch rows)', () => {
    expect(normalizeTimestampMs(1_700_000_000)).toBe(1_700_000_000_000)
  })

  it('keeps millisecond values as-is', () => {
    expect(normalizeTimestampMs(1_700_000_000_123)).toBe(1_700_000_000_123)
  })

  it('rejects missing, non-finite, and implausible values', () => {
    expect(normalizeTimestampMs(undefined)).toBeNull()
    expect(normalizeTimestampMs(0)).toBeNull()
    expect(normalizeTimestampMs(1)).toBeNull()
    expect(normalizeTimestampMs(Number.NaN)).toBeNull()
  })
})

describe('formatMessageTime', () => {
  const now = new Date(2026, 8, 27, 15, 0, 0).getTime()
  const yesterday = (time: string): string => `Yesterday ${time}`

  it('shows only the time for today', () => {
    const label = formatMessageTime(new Date(2026, 8, 27, 9, 5).getTime(), 'en-GB', yesterday, now)
    expect(label).toBe('09:05')
  })

  it('uses the localized yesterday label', () => {
    const label = formatMessageTime(new Date(2026, 8, 26, 22, 30).getTime(), 'en-GB', yesterday, now)
    expect(label).toBe('Yesterday 22:30')
  })

  it('adds the date for older messages in the same year, and the year otherwise', () => {
    const sameYear = formatMessageTime(new Date(2026, 2, 3, 8, 0).getTime(), 'en-GB', yesterday, now)
    expect(sameYear).toMatch(/3/)
    expect(sameYear).not.toMatch(/2026/)
    const lastYear = formatMessageTime(new Date(2025, 2, 3, 8, 0).getTime(), 'en-GB', yesterday, now)
    expect(lastYear).toMatch(/2025/)
  })

  it('accepts seconds-based timestamps', () => {
    const ms = new Date(2026, 8, 27, 9, 5).getTime()
    expect(formatMessageTime(Math.floor(ms / 1000), 'en-GB', yesterday, now)).toBe('09:05')
  })

  it('returns null for missing timestamps', () => {
    expect(formatMessageTime(undefined, 'en', yesterday, now)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('never shows zero seconds for a real duration', () => {
    expect(formatDuration(200, units)).toBe('1s')
  })

  it('keeps at most the two largest non-zero units', () => {
    expect(formatDuration(42_000, units)).toBe('42s')
    expect(formatDuration(65_000, units)).toBe('1m 5s')
    expect(formatDuration(3_600_000 + 5 * 60_000 + 9_000, units)).toBe('1h 5m')
    expect(formatDuration(2 * 86_400_000 + 3_600_000, units)).toBe('2d 1h')
  })

  it('skips zero units in the middle', () => {
    expect(formatDuration(3_600_000 + 7_000, units)).toBe('1h 7s')
  })

  it('returns null for missing or non-positive durations', () => {
    expect(formatDuration(undefined, units)).toBeNull()
    expect(formatDuration(0, units)).toBeNull()
    expect(formatDuration(-5, units)).toBeNull()
  })
})

describe('formatDateTime (lists: next run, saved at…)', () => {
  const now = new Date(2026, 8, 27, 18, 0).getTime()
  it('uses the app language and never shows seconds', async () => {
    const { formatDateTime, formatMessageTimeFull } = await import('../messageTime')
    const nextMorning = new Date(2026, 8, 28, 9, 0, 0).getTime()
    const ko = formatDateTime(nextMorning, 'ko', now)
    expect(ko).toMatch(/9\. 28\./)
    expect(ko).not.toMatch(/:00:00/)
    expect(formatDateTime(nextMorning, 'en', now)).toMatch(/^9\/28, 09:00( AM)?$/)
    expect(formatDateTime(new Date(2026, 8, 27, 9, 5).getTime(), 'ja', now)).toBe('09:05')
    expect(formatDateTime(new Date(2025, 0, 2, 9, 5).getTime(), 'en', now)).toContain('2025')
    expect(formatDateTime(0, 'en', now)).toBe('')
    expect(formatMessageTimeFull(nextMorning, 'zh')).not.toMatch(/:00:00/)
  })
})
