/**
 * Mask credentials in provider/transport error text before it is shown,
 * stored in a transcript, or printed by the headless CLI. Providers echo
 * keys back (e.g. OpenAI's "Incorrect API key provided: sk-…"), and proxies
 * sometimes echo request headers or URLs. Pure; safe for renderer + headless.
 */

const MASK = '***'

const RULES: Array<[RegExp, string]> = [
  // Passwords are often short (`password=hunter2`). `key: 404` stays on the rule below.
  [
    /((?:["']?)\b(?:password|passwd|pwd)\b["']?\s*[:=]\s*["']?)[^\s"',;&})\]]+/gi,
    `$1${MASK}`
  ],
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
  return text.replace(/\b((?:https?|wss?):\/\/)([^/\s@]+)@/gi, (whole, scheme: string, info: string) => {
    const colon = info.indexOf(':')
    if (colon >= 0) {
      return info.slice(colon + 1) ? `${scheme}${info.slice(0, colon)}:${MASK}@` : whole
    }
    return tokenishUser(info) ? `${scheme}${MASK}@` : whole
  })
}

const SECRET_PATH_NAME = /^(?:keys|tokens|api-key|key|token|secret)$/i

// shortcut: one letter plus one digit counts as high-entropy, upgrade if long slugs with a single digit show up
function highEntropySeg(seg: string): boolean {
  return seg.length >= 24 && /^[A-Za-z0-9_-]+$/.test(seg) && /[A-Za-z]/.test(seg) && /\d/.test(seg)
}

function maskPathsInUrl(url: string): string {
  const sl = url.indexOf('/', url.indexOf('://') + 3)
  if (sl < 0) return url
  const q = url.slice(sl).search(/[?#]/)
  const cut = q < 0 ? url.length : sl + q
  const segs = url.slice(sl, cut).split('/')
  for (let i = 1; i < segs.length; i++) {
    if (segs[i] && (SECRET_PATH_NAME.test(segs[i - 1]) || highEntropySeg(segs[i]))) segs[i] = MASK
  }
  return url.slice(0, sl) + segs.join('/') + url.slice(cut)
}

function maskUrlPaths(text: string): string {
  return text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, maskPathsInUrl)
}

// Key regexes stop at the newline, so the next pure-alnum line is still the key.
const MASKED_KEY_EOL = /(?:^|[^A-Za-z0-9_])(?:sk-ant-|sk-(?:proj-|or-v1-|or-)?|hf_|AIza|(?:xai|gsk|ghp|gho|ghs|github_pat|xox[baprs])-)\*\*\*$/

function maskKeyContinuations(text: string): string {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    if (MASKED_KEY_EOL.test(lines[i]) && /^[A-Za-z0-9]{8,}$/.test(lines[i + 1])) lines[i + 1] = MASK
  }
  return lines.join('\n')
}

export function redactSecrets(text: string): string {
  if (!text) return text
  let out = maskUrlPaths(maskUrlUserinfo(text))
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return maskKeyContinuations(out)
}
