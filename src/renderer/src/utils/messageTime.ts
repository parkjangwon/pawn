/**
 * Message timestamp + turn duration formatting for the chat timeline.
 *
 * In-memory messages carry `createdAt` in milliseconds (Date.now()), but rows
 * loaded from SQLite use `unixepoch()` seconds. Normalize before formatting so
 * both render the same way.
 */

/** Anything before 2000-01-01 is treated as missing/garbage. */
const MIN_PLAUSIBLE_MS = 946_684_800_000
/** Values below this are unix seconds, not milliseconds. */
const SECONDS_CUTOFF = 100_000_000_000

export function normalizeTimestampMs(value: number | undefined | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const ms = value < SECONDS_CUTOFF ? value * 1000 : value
  return ms >= MIN_PLAUSIBLE_MS ? ms : null
}

type FormatterKind = 'time' | 'monthDayTime' | 'full'
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, kind: FormatterKind): Intl.DateTimeFormat {
  const key = `${locale}:${kind}`
  const cached = formatterCache.get(key)
  if (cached) return cached
  const opts: Intl.DateTimeFormatOptions =
    kind === 'time'
      ? { hour: '2-digit', minute: '2-digit' }
      : kind === 'monthDayTime'
        ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  let f: Intl.DateTimeFormat
  try {
    f = new Intl.DateTimeFormat(locale, opts)
  } catch {
    f = new Intl.DateTimeFormat('en', opts)
  }
  formatterCache.set(key, f)
  return f
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * Compact, relative-first label: today → "14:32", yesterday → "Yesterday 14:32"
 * (via `yesterdayLabel`), same year → "9/21 14:32", otherwise full date.
 */
export function formatMessageTime(
  createdAt: number | undefined,
  locale: string,
  yesterdayLabel: (time: string) => string,
  now: number = Date.now()
): string | null {
  const ms = normalizeTimestampMs(createdAt)
  if (ms === null) return null
  const date = new Date(ms)
  const today = new Date(now)
  const time = formatter(locale, 'time').format(date)
  if (sameDay(date, today)) return time
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(date, yesterday)) return yesterdayLabel(time)
  if (date.getFullYear() === today.getFullYear()) return formatter(locale, 'monthDayTime').format(date)
  return formatter(locale, 'full').format(date)
}

/**
 * A date+time for lists (next run, saved at…), in the app language, without
 * seconds: today → "14:32", this year → "9/28 09:00", else the full date.
 * Future times read the same way ("today 09:00" is just "09:00").
 */
export function formatDateTime(ms: number | undefined | null, locale: string, now: number = Date.now()): string {
  const v = normalizeTimestampMs(ms ?? undefined)
  if (v === null) return ''
  const date = new Date(v)
  const today = new Date(now)
  if (sameDay(date, today)) return formatter(locale, 'time').format(date)
  if (date.getFullYear() === today.getFullYear()) return formatter(locale, 'monthDayTime').format(date)
  return formatter(locale, 'full').format(date)
}

/** Full, unambiguous timestamp for tooltips. */
export function formatMessageTimeFull(createdAt: number | undefined, locale: string): string | null {
  const ms = normalizeTimestampMs(createdAt)
  if (ms === null) return null
  return formatter(locale, 'full').format(new Date(ms))
}

export interface DurationUnits {
  d: (n: number) => string
  h: (n: number) => string
  m: (n: number) => string
  s: (n: number) => string
}

/**
 * "Worked for" duration: the two largest non-zero units (1h 5m, 2m 3s, 12s),
 * minimum 1 second so a fast turn never reads "0s".
 */
export function formatDuration(durationMs: number | undefined, units: DurationUnits): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null
  const total = Math.max(1, Math.round(durationMs / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (days > 0) parts.push(units.d(days))
  if (hours > 0) parts.push(units.h(hours))
  if (minutes > 0) parts.push(units.m(minutes))
  if (seconds > 0 || parts.length === 0) parts.push(units.s(seconds))
  return parts.slice(0, 2).join(' ')
}
