/**
 * Single place that turns a raw provider/transport error into a user-facing
 * failure class plus a "likely cause" and "what to do" line. Used by the chat
 * error card (renderer) and the headless CLI result. Pure except
 * enrichTransportError, which asks window.api.net.probe. No Electron import.
 *
 * Inputs look like `HTTP 401: {"error":...}` (see llmRetry.fetchWithRetry),
 * Node/undici network errors (`fetch failed`, `ECONNREFUSED`, ...), or plain
 * provider messages.
 */

import { EN, tx } from '../i18n/strings'
import { redactSecrets } from './redactSecrets'
import { summarizeProviderError } from './testProvider'

export type ProviderErrorKind =
  | 'auth'
  | 'billing'
  | 'rate'
  | 'server'
  | 'network'
  | 'model'
  | 'context'
  | 'config'
  | 'generic'

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
  | 'quota'
  | 'badEndpoint'
  | 'badPort'
  | 'invalidUrl'
  | 'setup'

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
  server: 'server',
  quota: 'billing',
  badEndpoint: 'config',
  badPort: 'config',
  invalidUrl: 'config',
  setup: 'config'
}

const TARGET_OF: Partial<Record<ProviderErrorKind, ProviderSettingsTarget>> = {
  auth: 'providers',
  config: 'providers',
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
  // Out of credits / billing: OpenAI sends insufficient_quota with 429, others 402/400.
  if (
    status === '402' ||
    has(s, 'insufficient_quota', 'exceeded your current quota', 'credit balance is too low', 'insufficient credits', 'insufficient balance', 'insufficient_balance', 'out of credits', 'billing hard limit', 'billing_not_active', 'payment required', 'add a payment method', 'requires more credits')
  ) {
    return 'quota'
  }
  if (status === '401') return 'invalidKey'
  if (status === '403') return 'forbidden'
  if (has(s, 'invalid api key', 'invalid_api_key', 'incorrect api key', 'invalid x-api-key', 'authentication_error', 'unauthorized')) {
    return 'invalidKey'
  }
  if (status === '407' || (status === undefined && has(s, 'proxy'))) return 'proxy'
  if (status === '429' || has(s, 'rate limit', 'rate_limit', 'too many requests')) return 'rateLimit'
  const mentionsModel =
    has(s, 'model_not_found', 'model not found', 'unknown model', 'no such model', 'invalid model', 'not a valid model', 'model_not_available') ||
    (s.includes('model') && has(s, 'does not exist', 'not found', 'not supported', 'unsupported', 'not available'))
  if (mentionsModel) return 'unknownModel'
  // A 404 that doesn't talk about a model: the URL/path itself is wrong.
  if (status === '404') return 'badEndpoint'
  if (status !== undefined && status.startsWith('5')) return 'server'
  if (has(s, 'overloaded')) return 'server'

  // Transport failures (no HTTP status).
  if (status === undefined) {
    // Before offline: Chromium wraps EINVALIDURL as "Failed to fetch (cause: …)".
    if (has(s, 'einvalidurl', 'invalid url', 'err_invalid_url')) return 'invalidUrl'
    // undici refuses some ports outright (e.g. :1, :6000) before connecting.
    if (has(s, 'bad port', 'ebadport')) return 'badPort'
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
const KINDS: ProviderErrorKind[] = ['auth', 'billing', 'rate', 'server', 'network', 'model', 'context', 'config', 'generic']

export interface ProviderErrorCopy {
  title: string
  /** Likely cause; empty when unknown. */
  cause: string
  /** Concrete next step. */
  fix: string
}

export function describeProviderError(info: Pick<ProviderErrorInfo, 'kind' | 'reason'> & { detail?: string }): ProviderErrorCopy {
  const kind = KINDS.includes(info.kind) ? info.kind : 'generic'
  const reason = info.reason && info.reason in KIND_OF ? info.reason : undefined
  const titleKey = reason ? `chat.errorCard.title.${reason}` : ''
  const code = info.detail?.match(/HTTP (\d{3})/)?.[1]
  const cause = reason ? tx(`chat.errorCard.cause.${reason}`) : ''
  return {
    title: tx(titleKey in EN ? titleKey : `chat.errorCard.title${cap(kind)}`),
    cause: cause && code ? cause.replace(/\.?$/, ` (HTTP ${code}).`) : cause,
    fix: reason ? tx(`chat.errorCard.fix.${reason}`) : tx(`chat.errorCard.hint${cap(kind)}`)
  }
}

/**
 * Settings → Providers "Test connection" failure line:
 * `Connection failed (401): the API key was rejected. …`
 */
export function formatConnectionTestFailure(rawMessage: string): string {
  const reason = providerErrorReason(rawMessage)
  const http = rawMessage.match(/HTTP (\d{3})(?::\s*([\s\S]*))?/)
  const label = http?.[1] ?? rawMessage.match(/\(cause: ([A-Za-z0-9_]+)/)?.[1] ?? (reason === 'timeout' ? 'timeout' : reason && KIND_OF[reason] === 'network' ? 'network' : 'error')
  // Redact before summarize/truncate so a cut-off key can't slip past the masker.
  const summary = http ? summarizeProviderError(Number(http[1]), redactSecrets(http[2] ?? '')).replace(/^FAIL: \d{3}(?: — )?/, '') : redactSecrets(rawMessage)
  const body = reason ? tx(`chat.connTest.${reason}`) : summary.slice(0, 120)
  return `Connection failed (${label}): ${body}`
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
const TRANSPORT_FAILURE = /failed to fetch|fetch failed|networkerror/i

type ProbeResult = { code?: string; message?: string } | null

// One probe per url for the life of `scope` (pass the turn AbortSignal). Dies with the key.
const probeCache = new WeakMap<object, Map<string, Promise<ProbeResult>>>()

async function runProbe(url: string): Promise<ProbeResult> {
  try {
    if (typeof window === 'undefined' || !window.api?.net?.probe) return null
    return (await window.api.net.probe(url)) ?? null
  } catch {
    return null
  }
}

function applyProbe(message: string, result: ProbeResult): string {
  if (!result?.code) return message
  return `${message} (cause: ${result.code}${result.message ? ` ${result.message}` : ''})`
}

/**
 * Chromium's fetch reports every transport failure as "Failed to fetch".
 * Ask the main process to connect once and append its cause code.
 * Pass `scope` (the turn's AbortSignal) to reuse a probe for that url.
 * Never throws.
 */
export async function enrichTransportError(
  message: string,
  url: string | undefined,
  scope?: object
): Promise<string> {
  try {
    if (!url || message.includes('(cause:') || !TRANSPORT_FAILURE.test(message)) return message
    let pending: Promise<ProbeResult>
    if (scope) {
      let byUrl = probeCache.get(scope)
      if (!byUrl) probeCache.set(scope, (byUrl = new Map()))
      pending = byUrl.get(url) ?? runProbe(url)
      byUrl.set(url, pending)
    } else {
      pending = runProbe(url)
    }
    return applyProbe(message, await pending)
  } catch {
    return message
  }
}

export function errorTextWithCause(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err)
  const cause = (err as { cause?: unknown } | null)?.cause
  if (!cause || typeof cause !== 'object') return redactSecrets(base)
  const c = cause as { code?: unknown; message?: unknown }
  const parts = [c.code, c.message].filter((x): x is string => typeof x === 'string' && x.length > 0)
  const extra = [...new Set(parts)].join(' ')
  return redactSecrets(extra && !base.includes(extra) ? `${base} (cause: ${extra})` : base)
}

/**
 * The first attempt is the model the user picked (or the router's first choice).
 * A later fallback's 404/429 must not hide that error on the card.
 */
export function formatAllAttemptsFailed(
  first: { label: string; message: string },
  last: { label: string; message: string }
): string {
  const head = `All model attempts failed. ${first.label}: ${first.message}`
  const out = last.message === first.message ? head : `${head} (fallbacks also failed; last: ${last.label}: ${last.message.slice(0, 200)})`
  return redactSecrets(out)
}
