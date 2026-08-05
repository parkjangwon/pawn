/**
 * Redaction & rejection for durable memories.
 * Never persist secrets; treat memory text as untrusted when re-injected.
 */

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github_pat', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'openai_key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/ },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'generic_bearer', re: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/i },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'password_assign', re: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i },
  { name: 'connection_string', re: /\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis):\/\/[^\s]+/i }
]

export function redactSecrets(text: string): { text: string; redacted: string[] } {
  let out = text
  const redacted: string[] = []
  for (const { name, re } of SECRET_PATTERNS) {
    // Clone with global flag so every occurrence is redacted (patterns are non-global).
    const gre = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    if (gre.test(out)) {
      gre.lastIndex = 0
      out = out.replace(gre, `[REDACTED:${name}]`)
      if (!redacted.includes(name)) redacted.push(name)
    }
  }
  return { text: out, redacted }
}

/** Reject empty / useless / pure secret cards. */
export function validateMemoryContent(raw: string): { ok: boolean; reason?: string; content?: string } {
  const trimmed = (raw || '').trim()
  if (trimmed.length < 8) return { ok: false, reason: 'too_short' }
  if (trimmed.length > 4000) return { ok: false, reason: 'too_long' }
  const { text, redacted } = redactSecrets(trimmed)
  // If almost everything was redacted, drop
  const visible = text.replace(/\[REDACTED:[^\]]+\]/g, '').trim()
  if (visible.length < 8) return { ok: false, reason: 'only_secrets' }
  if (redacted.length && visible.length < trimmed.length * 0.2) {
    return { ok: false, reason: 'mostly_secrets' }
  }
  return { ok: true, content: text }
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of tags) {
    const s = String(t || '')
      .trim()
      .toLowerCase()
      .slice(0, 40)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= 12) break
  }
  return out
}
