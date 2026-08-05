/**
 * Multi-layer response validation — 200 is the start of checking, not success.
 * Port of insane-search engine/validators.py core (MIT).
 */
import type { Verdict } from './types'

export interface ValidationResult {
  verdict: Verdict
  reasons: string[]
  matchedSelectors?: string[]
}

const HARD_MARKERS = [
  'cf-browser-verification',
  'cf-challenge',
  'challenge-platform',
  'just a moment',
  'checking your browser',
  'enable javascript and cookies',
  'attention required',
  'access denied',
  'request blocked',
  'bot detection',
  'captcha',
  'hcaptcha',
  'recaptcha',
  'datadome',
  'perimeterx',
  'px-captcha',
  'akamai',
  'human verification',
  'security check'
]

const SOFT_MARKERS = [
  'cloudflare',
  'ddos protection',
  'please verify you are a human',
  'are you a robot',
  'unusual traffic',
  'verify you are human'
]

const AUTH_MARKERS = [
  'sign in to continue',
  'log in to continue',
  'please log in',
  'please sign in',
  'authentication required',
  'login required',
  'create an account to continue',
  'members only'
]

const PAYWALL_MARKERS = [
  'subscribe to read',
  'subscription required',
  'paywall',
  'become a member to read',
  'this article is for subscribers'
]

const SMALL_BODY = 800
const SOFT_MENTION_MAX = 4000

function hits(bodyLower: string, markers: string[]): string[] {
  return markers.filter((m) => bodyLower.includes(m))
}

function looksCompleteContentPage(text: string, lowered: string): boolean {
  if (text.length < 80) return false
  const hasHtml = /<\/?(html|body|p|div|article|main|h1)\b/i.test(text)
  const hasText = /[a-zA-Z가-힣]{20,}/.test(text)
  const scriptOnly = (text.match(/<script/gi) || []).length >= 3 && text.replace(/<script[\s\S]*?<\/script>/gi, '').trim().length < 100
  if (scriptOnly) return false
  // challenge pages often lack real body text
  if (hits(lowered, HARD_MARKERS).length) return false
  return hasHtml || hasText
}

export function validateResponse(opts: {
  status: number
  text: string
  contentType?: string
  finalUrl?: string
}): ValidationResult {
  const reasons: string[] = []
  const status = opts.status || 0
  const text = opts.text || ''
  const lowered = text.toLowerCase()
  const size = Buffer.byteLength(text, 'utf8')
  const ctype = (opts.contentType || '').toLowerCase()

  if (status === 404 || status === 410) {
    return { verdict: 'not_found', reasons: [`status:${status}`] }
  }
  if (status === 401 || status === 403) {
    // 403 may be WAF not real auth — still mark blocked for escalation
    if (status === 401 || hits(lowered, AUTH_MARKERS).length) {
      return { verdict: 'auth_required', reasons: [`status:${status}`, ...hits(lowered, AUTH_MARKERS).slice(0, 2)] }
    }
    return { verdict: 'blocked', reasons: [`status:${status}`] }
  }
  if (status === 429) {
    return { verdict: 'rate_limited', reasons: ['status:429'] }
  }
  if (status === 402 || hits(lowered, PAYWALL_MARKERS).length >= 1) {
    const p = hits(lowered, PAYWALL_MARKERS)
    if (status === 402 || p.length) {
      return { verdict: 'paywall', reasons: status === 402 ? ['status:402'] : p.slice(0, 2) }
    }
  }
  if (status >= 500 && status > 0) {
    return { verdict: 'error', reasons: [`status:${status}`] }
  }
  if (status === 0) {
    return { verdict: 'error', reasons: ['no_response'] }
  }

  const hard = hits(lowered, HARD_MARKERS)
  if (hard.length) {
    return { verdict: 'challenge', reasons: hard.slice(0, 3).map((m) => `hard:${m}`) }
  }

  // JSON / feed success
  if (
    ctype.includes('json') ||
    text.trimStart().startsWith('{') ||
    text.trimStart().startsWith('[')
  ) {
    try {
      JSON.parse(text)
      if (size > 20) return { verdict: 'strong_ok', reasons: ['json_ok'] }
    } catch {
      reasons.push('json_parse_fail')
    }
  }
  if (/<(rss|feed)\b/i.test(text.slice(0, 800))) {
    return { verdict: 'strong_ok', reasons: ['feed_ok'] }
  }

  const auth = hits(lowered, AUTH_MARKERS)
  if (auth.length >= 2 || (auth.length === 1 && size < 5000)) {
    return { verdict: 'auth_required', reasons: auth.slice(0, 2) }
  }

  const soft = hits(lowered, SOFT_MARKERS)
  if (soft.length) {
    if (soft.length >= 2 || size <= SOFT_MENTION_MAX) {
      return { verdict: 'challenge', reasons: soft.slice(0, 3).map((m) => `soft:${m}`) }
    }
    reasons.push(`soft_mention:${soft[0]}`)
  }

  if (size < SMALL_BODY) {
    if (looksCompleteContentPage(text, lowered)) {
      return { verdict: 'weak_ok', reasons: [`small_but_complete:${size}`, ...reasons] }
    }
    return { verdict: 'challenge', reasons: [`tiny_body:${size}`, ...reasons] }
  }

  // Jina reader often returns plain markdown with title
  if (opts.finalUrl?.includes('r.jina.ai') && size > 200) {
    return { verdict: 'strong_ok', reasons: ['jina_ok', ...reasons] }
  }

  if (status >= 200 && status < 300) {
    return { verdict: 'weak_ok', reasons: reasons.length ? reasons : ['clean_200'] }
  }

  return { verdict: 'unknown', reasons: [`status:${status}`, ...reasons] }
}

export function isSuccessVerdict(v: string): boolean {
  return v === 'strong_ok' || v === 'weak_ok'
}

export function isTerminalFailure(v: string): boolean {
  return v === 'auth_required' || v === 'not_found' || v === 'paywall'
}
