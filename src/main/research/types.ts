/** Shared types for the built-in public-web research engine (insane-search port). */

export type Verdict =
  | 'strong_ok'
  | 'weak_ok'
  | 'suspect_ok'
  | 'challenge'
  | 'blocked'
  | 'rate_limited'
  | 'auth_required'
  | 'not_found'
  | 'paywall'
  | 'unknown'
  | 'error'

export interface Attempt {
  phase: string
  executor: string
  url: string
  urlTransform: string
  impersonate: string | null
  referer: string
  status: number
  bodySize: number
  verdict: string
  reasons: string[]
  elapsedMs: number
  error?: string
}

export interface FetchResult {
  ok: boolean
  content: string
  finalUrl: string
  verdict: string
  profileUsed: string | null
  trace: Attempt[]
  summary: string
  plannedAttempts: number
  executedAttempts: number
  gridExhausted: boolean
  stopReason: string
  untriedRoutes: string[]
  /** When true, agent should escalate with browser_* tools. */
  mustInvokeBrowser: boolean
  contentTrust: string
  promptInjectionRisk: string
  promptInjectionSignals: string[]
  extractionQuality: number
  extractionSource: string
  blockClass: string
  platform?: string
  route?: string
  title?: string
}

export interface RawResponse {
  url: string
  status: number
  headers: Record<string, string>
  text: string
  bytes: Uint8Array
}

export interface FetchOptions {
  timeoutMs?: number
  maxAttempts?: number | null
  enablePhase0?: boolean
  enableJina?: boolean
  enableExtraction?: boolean
  deviceClass?: 'auto' | 'desktop' | 'mobile'
  maxContentChars?: number
}

export const DEFAULT_MAX_CONTENT = 80_000
export const CONTENT_TRUST = 'untrusted_public_web'
