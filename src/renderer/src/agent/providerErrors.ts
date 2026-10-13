/**
 * Single place that turns a raw provider/transport error into a user-facing
 * failure class plus a "likely cause" and "what to do" line. Used by the chat
 * error card (renderer) and the headless CLI result. Pure: no DOM, no Electron.
 *
 * Inputs look like `HTTP 401: {"error":...}` (see llmRetry.fetchWithRetry),
 * Node/undici network errors (`fetch failed`, `ECONNREFUSED`, ...), or plain
 * provider messages.
 */

import { tx } from '../i18n/strings'
import { redactSecrets } from './redactSecrets'

export type ProviderErrorKind = 'auth' | 'rate' | 'server' | 'network' | 'model' | 'context' | 'generic'

export type ProviderErrorReason =
  | 'missingKey'
  | 'invalidKey'
  | 'forbidden'
  | 'offline'
  | 'dns'
  | 'timeout'
  | 'refused'
  | 'proxy'
  | 'unknownModel'
  | 'rateLimit'
  | 'contextTooLong'
  | 'server'

export type ProviderSettingsTarget = 'providers' | 'models' | 'usage'

export interface ProviderErrorInfo {
  kind: ProviderErrorKind
  /** Finer cause; absent for generic errors and for cards saved before it existed. */
  reason?: ProviderErrorReason
  /** Raw provider error text, for the collapsible details block. */
  detail: string
  /** Settings section a fix most likely lives in. */
  settingsTarget?: ProviderSettingsTarget
}

const has = (s: string, ...needles: string[]): boolean => needles.some((n) => s.includes(n))

const KIND_OF: Record<ProviderErrorReason, ProviderErrorKind> = {
  missingKey: 'auth',
  invalidKey: 'auth',
  forbidden: 'auth',
  offline: 'network',
  dns: 'network',
  timeout: 'network',
  refused: 'network',
  proxy: 'network',
  unknownModel: 'model',
  rateLimit: 'rate',
  contextTooLong: 'context',
  server: 'server'
}

const TARGET_OF: Partial<Record<ProviderErrorKind, ProviderSettingsTarget>> = {
  auth: 'providers',
  rate: 'models',
  server: 'models',
  model: 'models',
  context: 'models'
}

/** Pick the most specific reason from the message, or null for "unknown". */
export function providerErrorReason(message: string): ProviderErrorReason | null {
  const status = message.match(/HTTP (\d{3})/)?.[1]
  const s = message.toLowerCase()

  // Content-based checks first: providers return 400/404/413 for these.
  if (has(s, 'context_length_exceeded', 'context length', 'context window', 'maximum context', 'prompt is too long', 'too many tokens', 'input is too long', 'request too large') || status === '413') {
    return 'contextTooLong'
  }
  if (has(s, 'missing api key', 'no api key', 'api key is missing', 'api key not provided', 'apikey is required', 'api key is required', 'x-api-key header is required', 'missing authentication', 'no auth credentials')) {
    return 'missingKey'
  }
  if (status === '401') return 'invalidKey'
  if (status === '403') return 'forbidden'
  if (has(s, 'invalid api key', 'invalid_api_key', 'incorrect api key', 'invalid x-api-key', 'authentication_error', 'unauthorized')) {
    return 'invalidKey'
  }
  if (status === '407' || (status === undefined && has(s, 'proxy'))) return 'proxy'
  if (status === '429' || has(s, 'rate limit', 'rate_limit', 'too many requests', 'quota')) return 'rateLimit'
  if (
    status === '404' ||
    has(s, 'model_not_found', 'model not found', 'unknown model', 'does not exist', 'no such model', 'invalid model', 'not a valid model')
  ) {
    return 'unknownModel'
  }
  if (status !== undefined && status.startsWith('5')) return 'server'
  if (has(s, 'overloaded')) return 'server'

  // Transport failures (no HTTP status).
  if (status === undefined) {
    if (has(s, 'enotfound', 'eai_again', 'getaddrinfo', 'err_name_not_resolved')) return 'dns'
    if (has(s, 'econnrefused', 'err_connection_refused')) return 'refused'
    if (has(s, 'etimedout', 'timed out', 'timeout', 'und_err_connect_timeout', 'err_timed_out')) return 'timeout'
    if (has(s, 'err_internet_disconnected', 'enetunreach', 'ehostunreach', 'offline')) return 'offline'
    if (has(s, 'fetch failed', 'failed to fetch', 'networkerror', 'network error', 'econnreset', 'socket hang up', 'err_internet')) return 'offline'
  }
  return null
}

/** Map a thrown LLM error to a user-facing failure class for the error card. */
export function classifyProviderError(message: string): ProviderErrorInfo {
  const safe = redactSecrets(message)
  const detail = safe.length > 500 ? `${safe.slice(0, 500)}…` : safe
  const reason = providerErrorReason(message)
  if (!reason) return { kind: 'generic', detail }
  const kind = KIND_OF[reason]
  const settingsTarget = TARGET_OF[kind]
  return { kind, reason, detail, ...(settingsTarget ? { settingsTarget } : {}) }
}

const cap = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1)
const KINDS: ProviderErrorKind[] = ['auth', 'rate', 'server', 'network', 'model', 'context', 'generic']

export interface ProviderErrorCopy {
  title: string
  /** Likely cause; empty when unknown. */
  cause: string
  /** Concrete next step. */
  fix: string
}

export function describeProviderError(info: Pick<ProviderErrorInfo, 'kind' | 'reason'>): ProviderErrorCopy {
  const kind = KINDS.includes(info.kind) ? info.kind : 'generic'
  const reason = info.reason && info.reason in KIND_OF ? info.reason : undefined
  return {
    title: tx(`chat.errorCard.title${cap(kind)}`),
    cause: reason ? tx(`chat.errorCard.cause.${reason}`) : '',
    fix: reason ? tx(`chat.errorCard.fix.${reason}`) : tx(`chat.errorCard.hint${cap(kind)}`)
  }
}

/** One-paragraph plain-text form for logs and the headless CLI. */
export function formatProviderError(message: string): string {
  const copy = describeProviderError(classifyProviderError(message))
  return [copy.title + '.', copy.cause, `Fix: ${copy.fix}`].filter(Boolean).join(' ')
}

/** Short fix hint for a known cause ('' when unknown) — for compact status lines. */
export function providerErrorFix(message: string): string {
  const reason = providerErrorReason(message)
  return reason ? tx(`chat.errorCard.fix.${reason}`) : ''
}

/** Append the fix hint to a compact status line, if one applies. */
export function withProviderErrorFix(summary: string, rawMessage: string): string {
  const fix = providerErrorFix(rawMessage)
  const safe = redactSecrets(summary)
  return fix ? `${safe} — ${fix}` : safe
}

/**
 * Error text including the low-level cause. Node's fetch throws a bare
 * "fetch failed" and keeps the useful part (ECONNREFUSED, ENOTFOUND, timeout)
 * on `err.cause`, so classification needs both.
 */
export function errorTextWithCause(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err)
  const cause = (err as { cause?: unknown } | null)?.cause
  if (!cause || typeof cause !== 'object') return redactSecrets(base)
  const c = cause as { code?: unknown; message?: unknown }
  const parts = [c.code, c.message].filter((x): x is string => typeof x === 'string' && x.length > 0)
  const extra = [...new Set(parts)].join(' ')
  return redactSecrets(extra && !base.includes(extra) ? `${base} (cause: ${extra})` : base)
}
