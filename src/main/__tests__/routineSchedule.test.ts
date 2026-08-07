import { describe, it, expect } from 'vitest'
import {
  computeNextRun,
  isValidCron,
  nextCronRun,
  parseRoutineConfig,
  parseSchedule
} from '../routineSchedule'

describe('parseSchedule', () => {
  it('parses interval, daily and weekly schedules', () => {
    expect(parseSchedule('{"type":"interval","minutes":45}')).toEqual({ type: 'interval', minutes: 45 })
    expect(parseSchedule('{"type":"daily","hour":9,"minute":30}')).toEqual({ type: 'daily', hour: 9, minute: 30 })
    expect(parseSchedule('{"type":"weekly","weekday":1,"hour":8,"minute":15}')).toEqual({ type: 'weekly', weekday: 1, hour: 8, minute: 15 })
  })

  it('parses cron and file_watch schedules', () => {
    expect(parseSchedule('{"type":"cron","expr":"0 9 * * 1-5"}')).toEqual({
      type: 'cron',
      expr: '0 9 * * 1-5'
    })
    expect(parseSchedule('{"type":"file_watch","path":"/tmp/inbox","debounceMinutes":5}')).toEqual({
      type: 'file_watch',
      path: '/tmp/inbox',
      debounceMinutes: 5
    })
  })

  it('parses policy fields alongside schedule', () => {
    const cfg = parseRoutineConfig(
      JSON.stringify({
        type: 'interval',
        minutes: 30,
        maxRetries: 2,
        steps: ['step a', 'step b'],
        dependsOn: ['r1']
      })
    )
    expect(cfg?.schedule).toEqual({ type: 'interval', minutes: 30 })
    expect(cfg?.policy.maxRetries).toBe(2)
    expect(cfg?.policy.steps).toEqual(['step a', 'step b'])
    expect(cfg?.policy.dependsOn).toEqual(['r1'])
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
    expect(parseSchedule('{"type":"cron","expr":"bad"}')).toBeNull()
  })
})

describe('cron', () => {
  it('validates 5-field expressions', () => {
    expect(isValidCron('0 9 * * 1-5')).toBe(true)
    expect(isValidCron('* * * * *')).toBe(true)
    expect(isValidCron('0 9 * *')).toBe(false)
  })

  it('computes next cron run after a reference time', () => {
    // Monday 2026-08-03 08:00 → next weekday 9:00 same day
    const from = new Date(2026, 7, 3, 8, 0, 0).getTime()
    const next = nextCronRun('0 9 * * 1-5', from)
    expect(next).toBe(new Date(2026, 7, 3, 9, 0, 0).getTime())
  })
})

describe('computeNextRun', () => {
  it('adds the interval to the reference time', () => {
    const from = new Date(2026, 7, 1, 10, 0, 0).getTime()
    expect(computeNextRun({ type: 'interval', minutes: 90 }, from)).toBe(from + 90 * 60_000)
  })

  it('advances file_watch by debounce minutes', () => {
    const from = new Date(2026, 7, 1, 10, 0, 0).getTime()
    expect(
      computeNextRun({ type: 'file_watch', path: '/tmp/x', debounceMinutes: 3 }, from)
    ).toBe(from + 3 * 60_000)
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
