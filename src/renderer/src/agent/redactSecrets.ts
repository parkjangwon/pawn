/**
 * Mask credentials in provider/transport error text before it is shown,
 * stored in a transcript, or printed by the headless CLI. Providers echo
 * keys back (e.g. OpenAI's "Incorrect API key provided: sk-…"), and proxies
 * sometimes echo request headers or URLs. Pure; safe for renderer + headless.
 */

const MASK = '***'

const RULES: Array<[RegExp, string]> = [
  // Header/JSON/form assignments: authorization, api_key, x-api-key, token, secret…
  // Value may be quoted and may carry a scheme ("Bearer abc").
  // Bare `key` too. Value must be >= 8 so `key: 404` and other short words survive.
  [
    /((?:["']?)\b(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|token|key)\b["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;&}\]]{8,}/gi,
    `$1${MASK}`
  ],
  // Query-string credentials: ?key=…, &api_key=…, &access_token=…
  [/([?&](?:key|api[_-]?key|apikey|access[_-]?token|token|sig|signature)=)[^&\s"'#]+/gi, `$1${MASK}`],
  // Bare auth schemes anywhere. Case-insensitive (BEARER / bearer).
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  // Well-known key shapes.
  [/\bsk-ant-[A-Za-z0-9_-]{6,}/g, `sk-ant-${MASK}`],
  [/\bsk-(?:proj-|or-v1-|or-)?[A-Za-z0-9_-]{6,}/g, `sk-${MASK}`],
  [/\bhf_[A-Za-z0-9]{10,}/g, `hf_${MASK}`],
  [/\b(xai|gsk|ghp|gho|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{10,}/g, `$1-${MASK}`],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, `AIza${MASK}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK],
  // Long opaque token right after a key-ish phrase: "API key provided: abcd…".
  [/((?:api key|key|token|secret)(?: provided)?\s*[:=]?\s+)([A-Za-z0-9._-]{20,})/gi, `$1${MASK}`]
]

// User-only URL tokens: a digit and length >= 8, a long opaque blob, or a known prefix.
// Leaves `https://username@github.com/...` alone.
function tokenishUser(info: string): boolean {
  if (/^(?:hf_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{6,}|gh[pousr]_|github_pat_|xox[baprs]-|AIza[0-9A-Za-z_-]{10,})/.test(info)) return true
  if (info.length >= 20 && /^[A-Za-z0-9._~+/-]+$/.test(info)) return true
  return info.length >= 8 && /\d/.test(info) && /^[A-Za-z0-9._~+/-]+$/.test(info)
}

/** `https://user:PASS@host` → `https://user:***@host`; token-as-user too. Emails have no scheme. */
function maskUrlUserinfo(text: string): string {
  return text.replace(/\b(https?:\/\/)([^/\s@]+)@/gi, (whole, scheme: string, info: string) => {
    const colon = info.indexOf(':')
    if (colon >= 0) {
      return info.slice(colon + 1) ? `${scheme}${info.slice(0, colon)}:${MASK}@` : whole
    }
    return tokenishUser(info) ? `${scheme}${MASK}@` : whole
  })
}

export function redactSecrets(text: string): string {
  if (!text) return text
  let out = maskUrlUserinfo(text)
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}
