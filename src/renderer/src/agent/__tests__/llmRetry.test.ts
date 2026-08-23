import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseRetryAfterHeader,
  calculateBackoffDelay,
  fetchWithRetry,
  markTransient
} from '../llm'

describe('llm retry and backoff utilities', () => {
  describe('parseRetryAfterHeader', () => {
    it('returns null for empty or invalid header', () => {
      expect(parseRetryAfterHeader(null)).toBeNull()
      expect(parseRetryAfterHeader(undefined)).toBeNull()
      expect(parseRetryAfterHeader('')).toBeNull()
      expect(parseRetryAfterHeader('invalid-string')).toBeNull()
    })

    it('parses integer seconds correctly', () => {
      expect(parseRetryAfterHeader('5')).toBe(5000)
      expect(parseRetryAfterHeader(' 12 ')).toBe(12000)
      expect(parseRetryAfterHeader('0')).toBe(100) // Minimum 100ms
    })

    it('caps large retry-after seconds to max limit', () => {
      expect(parseRetryAfterHeader('100')).toBe(30000) // Max 30s
    })

    it('parses valid HTTP-date in the future', () => {
      const future = new Date(Date.now() + 8000).toUTCString()
      const delay = parseRetryAfterHeader(future)
      expect(delay).toBeGreaterThan(5000)
      expect(delay).toBeLessThanOrEqual(10000)
    })
  })

  describe('calculateBackoffDelay', () => {
    it('uses retryAfterMs directly when provided', () => {
      expect(calculateBackoffDelay(1, false, 4500)).toBe(4500)
      expect(calculateBackoffDelay(2, true, 8000)).toBe(8000)
    })

    it('calculates exponential backoff with jitter for transient errors', () => {
      const delay1 = calculateBackoffDelay(1, false)
      const delay2 = calculateBackoffDelay(2, false)
      const delay3 = calculateBackoffDelay(3, false)

      expect(delay1).toBeGreaterThanOrEqual(500)
      expect(delay1).toBeLessThanOrEqual(6000)
      expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.8)
      expect(delay3).toBeLessThanOrEqual(6000)
    })

    it('uses higher base and cap for rate limits (429)', () => {
      const delay1 = calculateBackoffDelay(1, true)
      expect(delay1).toBeGreaterThanOrEqual(1200)
      expect(delay1).toBeLessThanOrEqual(12000)
    })
  })

  describe('fetchWithRetry', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
      vi.useRealTimers()
    })

    it('returns response immediately on HTTP 200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      const controller = new AbortController()

      const res = await fetchWithRetry('https://example.com/api', {}, {}, false, controller.signal)
      expect(res.status).toBe(200)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    it('retries on 429 rate limit and succeeds on retry', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return new Response('Rate limit exceeded', {
            status: 429,
            headers: { 'retry-after': '1' }
          })
        }
        return new Response('success', { status: 200 })
      })

      const controller = new AbortController()
      const resPromise = fetchWithRetry('https://example.com/api', {}, {}, false, controller.signal)

      // Advance timers to trigger backoff wait
      await vi.advanceTimersByTimeAsync(2000)

      const res = await resPromise
      expect(res.status).toBe(200)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })

    it('does not retry 400 Bad Request and throws immediately', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('Invalid json', { status: 400 }))
      const controller = new AbortController()

      await expect(
        fetchWithRetry('https://example.com/api', {}, {}, false, controller.signal)
      ).rejects.toThrow('HTTP 400')
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })
  })
})
