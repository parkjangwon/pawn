/**
 * Scrub credential-looking values before text leaves the machine for a
 * decision model. A classifier never needs the secret itself — "export
 * API_KEY=[REDACTED]" rates the same as the original command.
 */

const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]'],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]'],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED JWT]'],
  // Authorization headers / bearer tokens.
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, (_m, scheme) => `${scheme} [REDACTED]`],
  // user:password@host in URLs.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, (_m, proto) => `${proto}[REDACTED]@`],
  // KEY=value / KEY: "value" where the name looks secret.
  [
    /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|credential|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/gi,
    (_m, name, sep, q) => `${name}${sep}${q}[REDACTED]${q}`
  ],
  // --password xyz / --token=xyz / -p'xyz' style CLI flags.
  [
    /(--?(?:api-?key|token|secret|password|passwd|pass|auth)(?:=|\s+))(["']?)[^\s"']{4,}\2/gi,
    (_m, flag, q) => `${flag}${q}[REDACTED]${q}`
  ]
]

export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const [re, rep] of RULES) {
    out = out.replace(re, rep as never)
  }
  return out
}

/** Deep-redact every string in a JSON-like value (objects keep their keys). */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 32) return value
  if (typeof value === 'string') return redactSecrets(value) as T
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, depth + 1)
    return out as T
  }
  return value
}
