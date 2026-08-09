/**
 * Lightweight secret heuristics for commit messages and staged patches.
 * False positives are possible; used as a soft gate, not a security boundary.
 */

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub PAT', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'GitLab PAT', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Generic API key assignment', re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"]{12,}['"]/i }
]

export function scanForSecrets(text: string): string[] {
  if (!text) return []
  const found: string[] = []
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) found.push(name)
  }
  return found
}

export function formatSecretScanBlock(hits: string[]): string {
  if (!hits.length) return ''
  return (
    `Possible secrets detected (${hits.join(', ')}). ` +
    `Remove credentials before committing, or confirm this is a false positive.`
  )
}
