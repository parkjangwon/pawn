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
  [
    /((?:["']?)(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|token)["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;&}\]]+/gi,
    `$1${MASK}`
  ],
  // Query-string credentials: ?key=…, &api_key=…, &access_token=…
  [/([?&](?:key|api[_-]?key|apikey|access[_-]?token|token|sig|signature)=)[^&\s"'#]+/gi, `$1${MASK}`],
  // Bare auth schemes anywhere.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${MASK}`],
  // Well-known key shapes.
  [/\bsk-ant-[A-Za-z0-9_-]{6,}/g, `sk-ant-${MASK}`],
  [/\bsk-(?:proj-|or-v1-|or-)?[A-Za-z0-9_-]{6,}/g, `sk-${MASK}`],
  [/\b(xai|gsk|ghp|gho|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{10,}/g, `$1-${MASK}`],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, `AIza${MASK}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK],
  // Long opaque token right after a key-ish phrase: "API key provided: abcd…".
  [/((?:api key|key|token|secret)(?: provided)?\s*[:=]?\s+)([A-Za-z0-9._-]{20,})/gi, `$1${MASK}`]
]

export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}
