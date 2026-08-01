/**
 * Pure scheduling math for recurring routines. Kept separate from the IPC layer
 * so the next-run calculations are unit-testable.
 */

export type RoutineSchedule =
  | { type: 'interval'; minutes: number }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number }

export function parseSchedule(json: string): RoutineSchedule | null {
  try {
    const s = JSON.parse(json) as RoutineSchedule
    if (s.type === 'interval') {
      const minutes = Math.max(1, Math.floor(Number(s.minutes) || 0))
      return { type: 'interval', minutes }
    }
    if (s.type === 'daily') {
      const hour = clampHour(Number(s.hour))
      const minute = clampMinute(Number(s.minute))
      return { type: 'daily', hour, minute }
    }
    if (s.type === 'weekly') {
      const weekday = Math.min(6, Math.max(0, Math.floor(Number(s.weekday) || 0)))
      const hour = clampHour(Number(s.hour))
      const minute = clampMinute(Number(s.minute))
      return { type: 'weekly', weekday, hour, minute }
    }
    return null
  } catch {
    return null
  }
}

function clampHour(n: number): number {
  return Math.min(23, Math.max(0, Math.floor(n) || 0))
}

function clampMinute(n: number): number {
  return Math.min(59, Math.max(0, Math.floor(n) || 0))
}

/** Next epoch-ms occurrence strictly after `from`. */
export function computeNextRun(schedule: RoutineSchedule, from = Date.now()): number {
  if (schedule.type === 'interval') {
    return from + schedule.minutes * 60_000
  }

  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setHours(schedule.hour, schedule.minute, 0, 0)

  if (schedule.type === 'daily') {
    if (d.getTime() <= from) d.setDate(d.getDate() + 1)
    return d.getTime()
  }

  // Weekly: advance until the target weekday is reached.
  let diff = (schedule.weekday - d.getDay() + 7) % 7
  if (diff === 0 && d.getTime() <= from) diff = 7
  d.setDate(d.getDate() + diff)
  return d.getTime()
}

/** Long intervals must be re-armed so setTimeout never overflows. */
export const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000
