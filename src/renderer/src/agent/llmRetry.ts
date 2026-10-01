/**
 * Transport retry policy for provider HTTP calls: Retry-After parsing,
 * jittered backoff, transient-error tagging, and the fetch loop. Kept apart
 * from the stream plumbing in llm.ts so it stays unit-testable in isolation.
 */

import { isDeepSeekRetryableError } from './deepseekCompat'

/**
 * Parse Retry-After header if present. Supports integer seconds and HTTP-date.
 * Returns delay in milliseconds, or null if unparseable / absent.
 */
export function parseRetryAfterHeader(headerVal: string | null | undefined): number | null {
  if (!headerVal) return null
  const trimmed = headerVal.trim()
  if (!trimmed) return null
  // Integer seconds
  const sec = Number(trimmed)
  if (Number.isFinite(sec) && sec >= 0) {
    return Math.min(30_000, Math.max(100, Math.round(sec * 1000)))
  }
  // HTTP-Date
  const parsedDate = Date.parse(trimmed)
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now()
    return Math.min(30_000, Math.max(100, diff))
  }
  return null
}

/**
 * Calculate exponential backoff delay with full jitter.
 * Prevents thundering herd problems across concurrent subagents or retrying requests.
 */
export function calculateBackoffDelay(
  attempt: number,
  isRateLimit: boolean,
  retryAfterMs?: number | null
): number {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return retryAfterMs
  }
  const base = isRateLimit ? 1600 : 700
  const maxCap = isRateLimit ? 12_000 : 6_000
  const exp = base * (1 << (Math.max(1, attempt) - 1))
  // Full jitter: random between 0 and min(maxCap, exp)
  const cappedExp = Math.min(maxCap, exp)
  const jitter = Math.random() * (cappedExp * 0.4)
  return Math.min(maxCap, Math.round(cappedExp * 0.8 + jitter))
}

/**
 * Retry only what is worth retrying on the *same* model: rate limits, 5xx and
 * network blips. A 4xx is a bad request and will fail identically forever, so it
 * propagates immediately and lets the router fail over to another model.
 */
/** Attach a transient flag so callers can skip cooling down a provider for
 *  permanent failures (bad key, unknown model, malformed request). */
export function markTransient(err: unknown, transient: boolean): Error {
  const e = err instanceof Error ? err : new Error(String(err))
  ;(e as Error & { transient?: boolean }).transient = transient
  return e
}

export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  isBrowser: boolean,
  signal: AbortSignal
): Promise<Response> {
  const payload = JSON.stringify(body)
  let lastError: Error | null = null

  // Flag set only when the error is transient (network blip, 429, 5xx).
  // 4xx and parse failures never retry — the same bytes fail forever.
  let retryable = false
  let lastRetryAfterMs: number | null = null
  let isRateLimit = false

  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (attempt > 0) {
      if (!retryable) throw lastError!
      const delayMs = calculateBackoffDelay(attempt, isRateLimit, lastRetryAfterMs)
      await new Promise((r) => setTimeout(r, delayMs))
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    }

    retryable = false
    lastRetryAfterMs = null
    isRateLimit = false

    let response: Response
    try {
      response = isBrowser
        ? await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, headers, body: payload }),
            signal
          })
        : await fetch(url, { method: 'POST', headers, body: payload, signal })
    } catch (err) {
      // Only a fetch that never produced a response is a network blip worth
      // retrying; a 4xx below is a bad request and must not be retried.
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (signal.aborted) throw err
      retryable = true
      lastError = markTransient(err, true)
      if (attempt === 2) throw lastError
      continue
    }

    if (response.ok) return response

    const status = response.status
    const text = await response.text().catch(() => '')
    const err = new Error(`HTTP ${status}: ${text.slice(0, 300)}`)
    const isDsRetry = isDeepSeekRetryableError(status, text)
    if (status === 429 || status >= 500 || isDsRetry) {
      retryable = true
      isRateLimit = status === 429 || isDsRetry
      const retryAfterHeader = response.headers?.get?.('retry-after')
      lastRetryAfterMs = parseRetryAfterHeader(retryAfterHeader)
      lastError = markTransient(err, true)
      continue
    }
    throw markTransient(err, false)
  }

  throw lastError ?? markTransient(new Error('request failed'), true)
}
