import { describe, it, expect } from 'vitest'
import { computeNextRun, parseSchedule } from '../routineSchedule'

describe('parseSchedule', () => {
  it('parses interval, daily and weekly schedules', () => {
    expect(parseSchedule('{"type":"interval","minutes":45}')).toEqual({ type: 'interval', minutes: 45 })
    expect(parseSchedule('{"type":"daily","hour":9,"minute":30}')).toEqual({ type: 'daily', hour: 9, minute: 30 })
    expect(parseSchedule('{"type":"weekly","weekday":1,"hour":8,"minute":15}')).toEqual({ type: 'weekly', weekday: 1, hour: 8, minute: 15 })
  })

  it('clamps out-of-range values', () => {
    expect(parseSchedule('{"type":"interval","minutes":0}')).toEqual({ type: 'interval', minutes: 1 })
    expect(parseSchedule('{"type":"daily","hour":99,"minute":-5}')).toEqual({ type: 'daily', hour: 23, minute: 0 })
    expect(parseSchedule('{"type":"weekly","weekday":9,"hour":25,"minute":61}')).toEqual({ type: 'weekly', weekday: 6, hour: 23, minute: 59 })
  })

  it('rejects malformed schedules', () => {
    expect(parseSchedule('not json')).toBeNull()
    expect(parseSchedule('{"type":"monthly"}')).toBeNull()
    expect(parseSchedule('{"type":"interval"}')).toEqual({ type: 'interval', minutes: 1 })
  })
})

describe('computeNextRun', () => {
  it('adds the interval to the reference time', () => {
    const from = new Date(2026, 7, 1, 10, 0, 0).getTime()
    expect(computeNextRun({ type: 'interval', minutes: 90 }, from)).toBe(from + 90 * 60_000)
  })

  it('rolls a daily schedule to the next occurrence', () => {
    const before = new Date(2026, 7, 1, 7, 0, 0).getTime()
    expect(computeNextRun({ type: 'daily', hour: 9, minute: 0 }, before))
      .toBe(new Date(2026, 7, 1, 9, 0, 0).getTime())

    const after = new Date(2026, 7, 1, 10, 0, 0).getTime()
    expect(computeNextRun({ type: 'daily', hour: 9, minute: 0 }, after))
      .toBe(new Date(2026, 7, 2, 9, 0, 0).getTime())
  })

  it('rolls a weekly schedule to the target weekday', () => {
    const from = new Date(2026, 7, 1, 10, 0, 0) // a Saturday
    const targetWeekday = (from.getDay() + 2) % 7 // Monday
    const next = computeNextRun({ type: 'weekly', weekday: targetWeekday, hour: 9, minute: 0 }, from.getTime())
    expect(next).toBe(new Date(2026, 7, 3, 9, 0, 0).getTime())
  })

  it('keeps today when the weekly time is still ahead', () => {
    const from = new Date(2026, 7, 1, 7, 0, 0) // Saturday
    const next = computeNextRun({ type: 'weekly', weekday: from.getDay(), hour: 9, minute: 0 }, from.getTime())
    expect(next).toBe(new Date(2026, 7, 1, 9, 0, 0).getTime())
  })
})
