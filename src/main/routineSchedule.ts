/**
 * Pure scheduling math for recurring routines. Kept separate from the IPC layer
 * so the next-run calculations are unit-testable.
 *
 * Supports: interval | daily | weekly | cron (5-field) | file_watch (next poll)
 */

export type RoutineSchedule =
  | { type: 'interval'; minutes: number }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number }
  | {
      type: 'cron'
      /** Standard 5-field cron: min hour day-of-month month day-of-week */
      expr: string
    }
  | {
      type: 'file_watch'
      /** Absolute or project-relative path to watch */
      path: string
      /** Debounce minutes between fires (default 1) */
      debounceMinutes?: number
    }

/** Optional automation policy embedded alongside schedule JSON. */
export type RoutinePolicy = {
  /** Max automatic retries after a failed run (default 0). */
  maxRetries?: number
  /** Seconds between retries (default 60). */
  retryDelaySec?: number
  /** Multi-step prompts executed in order in one session. */
  steps?: string[]
  /** Other routine ids that must have lastResult not starting with FAIL. */
  dependsOn?: string[]
  /** Skip a scheduled fire if previous run still streaming / unfinished. */
  skipIfRunning?: boolean
}

export type ParsedRoutineConfig = {
  schedule: RoutineSchedule
  policy: RoutinePolicy
}

function clampHour(n: number): number {
  return Math.min(23, Math.max(0, Math.floor(n) || 0))
}

function clampMinute(n: number): number {
  return Math.min(59, Math.max(0, Math.floor(n) || 0))
}

function parsePolicy(raw: Record<string, unknown>): RoutinePolicy {
  const policy: RoutinePolicy = {}
  if (raw.maxRetries != null) policy.maxRetries = Math.min(5, Math.max(0, Math.floor(Number(raw.maxRetries) || 0)))
  if (raw.retryDelaySec != null)
    policy.retryDelaySec = Math.min(3600, Math.max(10, Math.floor(Number(raw.retryDelaySec) || 60)))
  if (Array.isArray(raw.steps)) {
    policy.steps = raw.steps.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20)
  }
  if (Array.isArray(raw.dependsOn)) {
    policy.dependsOn = raw.dependsOn.map(String).filter(Boolean).slice(0, 10)
  }
  if (raw.skipIfRunning === true) policy.skipIfRunning = true
  return policy
}

/** Validate a 5-field cron expression lightly. */
export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return parts.every((p) => /^[\d*,\-\/]+$/.test(p))
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = Math.max(1, parseInt(stepStr, 10) || 1)
      if (range === '*') {
        if ((value - min) % step === 0) return true
        continue
      }
      const start = parseInt(range, 10)
      if (!Number.isNaN(start) && value >= start && (value - start) % step === 0) return true
      continue
    }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map((x) => parseInt(x, 10))
      if (!Number.isNaN(a) && !Number.isNaN(b) && value >= a && value <= b) return true
      continue
    }
    const n = parseInt(part, 10)
    if (n === value) return true
  }
  // clamp awareness
  void min
  void max
  return false
}

/** Next epoch-ms for a 5-field cron, scanning minute-by-minute (capped 366 days). */
export function nextCronRun(expr: string, from = Date.now()): number {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return from + 60_000
  const [minF, hourF, domF, monF, dowF] = parts
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = from + 366 * 24 * 60 * 60_000
  while (d.getTime() < limit) {
    const minute = d.getMinutes()
    const hour = d.getHours()
    const dom = d.getDate()
    const mon = d.getMonth() + 1
    const dow = d.getDay()
    if (
      cronFieldMatches(minF, minute, 0, 59) &&
      cronFieldMatches(hourF, hour, 0, 23) &&
      cronFieldMatches(domF, dom, 1, 31) &&
      cronFieldMatches(monF, mon, 1, 12) &&
      cronFieldMatches(dowF, dow, 0, 6)
    ) {
      return d.getTime()
    }
    d.setMinutes(d.getMinutes() + 1)
  }
  return from + 24 * 60 * 60_000
}

/**
 * Parse schedule JSON. Accepts legacy shapes plus policy fields at the top level:
 * { "type":"cron", "expr":"0 9 * * 1-5", "maxRetries":2, "steps":["..."] }
 */
export function parseSchedule(json: string): RoutineSchedule | null {
  const parsed = parseRoutineConfig(json)
  return parsed?.schedule ?? null
}

export function parseRoutineConfig(json: string): ParsedRoutineConfig | null {
  try {
    const s = JSON.parse(json) as Record<string, unknown>
    const policy = parsePolicy(s)
    if (s.type === 'interval') {
      const minutes = Math.max(1, Math.floor(Number(s.minutes) || 0))
      return { schedule: { type: 'interval', minutes }, policy }
    }
    if (s.type === 'daily') {
      return {
        schedule: { type: 'daily', hour: clampHour(Number(s.hour)), minute: clampMinute(Number(s.minute)) },
        policy
      }
    }
    if (s.type === 'weekly') {
      const weekday = Math.min(6, Math.max(0, Math.floor(Number(s.weekday) || 0)))
      return {
        schedule: {
          type: 'weekly',
          weekday,
          hour: clampHour(Number(s.hour)),
          minute: clampMinute(Number(s.minute))
        },
        policy
      }
    }
    if (s.type === 'cron') {
      const expr = String(s.expr || s.cron || '').trim()
      if (!isValidCron(expr)) return null
      return { schedule: { type: 'cron', expr }, policy }
    }
    if (s.type === 'file_watch') {
      const path = String(s.path || '').trim()
      if (!path) return null
      const debounceMinutes = Math.max(1, Math.floor(Number(s.debounceMinutes) || 1))
      return { schedule: { type: 'file_watch', path, debounceMinutes }, policy }
    }
    return null
  } catch {
    return null
  }
}

/** Next epoch-ms occurrence strictly after `from`. */
export function computeNextRun(schedule: RoutineSchedule, from = Date.now()): number {
  if (schedule.type === 'interval') {
    return from + schedule.minutes * 60_000
  }

  if (schedule.type === 'cron') {
    return nextCronRun(schedule.expr, from)
  }

  if (schedule.type === 'file_watch') {
    // Poll cadence for file watcher arm (actual fire is event-driven in IPC).
    const mins = schedule.debounceMinutes || 1
    return from + mins * 60_000
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
