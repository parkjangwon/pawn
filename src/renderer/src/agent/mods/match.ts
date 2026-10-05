import type { ModMatcher } from './types'

/** True when every matcher field equals the corresponding event field (string match). */
export function matcherMatches(matcher: ModMatcher | undefined, event: unknown): boolean {
  if (!matcher || Object.keys(matcher).length === 0) return true
  if (!event || typeof event !== 'object') return false
  const e = event as Record<string, unknown>
  for (const [key, expected] of Object.entries(matcher)) {
    const actual = e[key]
    if (typeof expected === 'string' && typeof actual === 'string') {
      if (expected !== actual && expected.toLowerCase() !== actual.toLowerCase()) return false
      continue
    }
    if (expected !== actual) return false
  }
  return true
}
