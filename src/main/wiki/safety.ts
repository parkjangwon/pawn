/**
 * Redaction & rejection for wiki writes.
 * Never persist secrets; wiki text is treated as untrusted when re-injected.
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
    const gre = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    if (gre.test(out)) {
      gre.lastIndex = 0
      out = out.replace(gre, '[REDACTED:' + name + ']')
      if (!redacted.includes(name)) redacted.push(name)
    }
  }
  return { text: out, redacted }
}

/**
 * Redact secrets across a page's fields. Returns the cleaned fields plus a
 * `mostlySecrets` verdict so the caller can reject pure secret dumps.
 */
export function validateWikiWrite(title: string, summary: string, body: string): {
  title: string
  summary: string
  body: string
  redacted: string[]
  mostlySecrets: boolean
} {
  const t = redactSecrets(title)
  const s = redactSecrets(summary)
  const b = redactSecrets(body)
  const seen = new Set<string>()
  const redacted: string[] = []
  for (const name of [...t.redacted, ...s.redacted, ...b.redacted]) {
    if (seen.has(name)) continue
    seen.add(name)
    redacted.push(name)
  }
  let mostlySecrets = false
  if (redacted.length) {
    const visible = b.text.replace(/\[REDACTED:[^\]]+\]/g, '').trim()
    const original = body.trim()
    if (visible.length < 8 || visible.length < original.length * 0.2) mostlySecrets = true
  }
  return { title: t.text, summary: s.text, body: b.text, redacted, mostlySecrets }
}
