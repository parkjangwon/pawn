/**
 * Transport retry policy for provider HTTP calls: Retry-After parsing,
 * jittered backoff, transient-error tagging, and the fetch loop. Kept apart
 * from the stream plumbing in llm.ts so it stays unit-testable in isolation.
 */

import { isDeepSeekRetryableError } from './deepseekCompat'
import { enrichTransportError, errorTextWithCause } from './providerErrors'

/** Total time fetchWithRetry may spend sleeping between attempts. */
export const RETRY_WAIT_BUDGET_MS = 20_000
/** Max single wait honoured from a Retry-After header. */
export const RETRY_AFTER_CAP_MS = 10_000

const QUOTA_MARKERS =
  /insufficient_quota|exceeded your current quota|credit balance is too low|insufficient credits|insufficient balance|insufficient_balance|out of credits|billing_not_active|billing hard limit|payment required/i

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

export type FetchProgress =
  | { phase: 'connecting' }
  | { phase: 'retrying'; attempt: number; max: number }

const MAX_ATTEMPTS = 3

/** Connect never started. A second one in a row will not recover inside the budget. */
function isConnectTimeout(err: unknown): boolean {
  const text = errorTextWithCause(err)
  if (/und_err_connect_timeout|connect timeout|connect-phase timeout/i.test(text)) return true
  return /etimedout/i.test(text) && /connect/i.test(text)
}

export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  isBrowser: boolean,
  signal: AbortSignal,
  probeScope?: object,
  onProgress?: (progress: FetchProgress) => void
): Promise<Response> {
  const payload = JSON.stringify(body)
  let lastError: Error | null = null
  // Probe only the error we are about to throw. Each probe can block ~5s.
  const scope = probeScope ?? signal
  const withProbe = async (err: Error): Promise<Error> => {
    if (isBrowser) return err
    const enriched = await enrichTransportError(err.message, url, scope, err)
    if (enriched === err.message) return err
    return markTransient(new Error(enriched, { cause: err }), true)
  }

  // Flag set only when the error is transient (network blip, 429, 5xx).
  // 4xx and parse failures never retry — the same bytes fail forever.
  let retryable = false
  let lastRetryAfterMs: number | null = null
  let isRateLimit = false
  let waitedMs = 0
  let connectStreak = 0

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (attempt > 0) {
      if (!retryable) throw await withProbe(lastError!)
      onProgress?.({ phase: 'retrying', attempt: attempt + 1, max: MAX_ATTEMPTS })
      const capped = lastRetryAfterMs && Math.min(lastRetryAfterMs, RETRY_AFTER_CAP_MS)
      const delayMs = calculateBackoffDelay(attempt, isRateLimit, capped)
      // Waiting would blow the budget: fail now so the user sees the error card.
      if (waitedMs + delayMs > RETRY_WAIT_BUDGET_MS) throw await withProbe(lastError!)
      waitedMs += delayMs
      await new Promise((r) => setTimeout(r, delayMs))
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    } else {
      onProgress?.({ phase: 'connecting' })
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
      if (signal.aborted) throw err
      const connectTimeout = isConnectTimeout(err)
      // Caller abort (Stop, idle timeout). Our connect-phase abort is retried once.
      if (err instanceof DOMException && err.name === 'AbortError' && !connectTimeout) throw err
      connectStreak = connectTimeout ? connectStreak + 1 : 0
      retryable = true
      lastError = markTransient(err instanceof Error ? err : new Error(String(err)), true)
      if (connectStreak >= 2 || attempt === MAX_ATTEMPTS - 1) throw await withProbe(lastError)
      continue
    }

    if (response.ok) return response

    const status = response.status
    const text = await response.text().catch(() => '')
    const err = new Error(`HTTP ${status}: ${text.slice(0, 300)}`)
    // Quota/billing failures arrive as 429 but never recover by waiting.
    if (status === 402 || QUOTA_MARKERS.test(text)) throw markTransient(err, false)
    const isDsRetry = isDeepSeekRetryableError(status, text)
    if (status === 429 || status >= 500 || isDsRetry) {
      retryable = true
      connectStreak = 0
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
