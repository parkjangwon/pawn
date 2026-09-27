/**
 * Code-aware tokenizer.
 *
 * Splits identifiers on camelCase / PascalCase / snake_case / kebab-case and
 * digit boundaries, lowercases, drops 1-char tokens and a small stopword set,
 * and applies light stemming. Deliberately avoids the regex `u` flag so it
 * stays compatible with the project's tsconfig.node.json settings.
 */

const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'or', 'is', 'for', 'with', 'on',
  'this', 'that', 'return', 'const', 'let', 'var', 'function', 'def', 'import',
  'from', 'export', 'public', 'private', 'static', 'new', 'true', 'false',
  'null', 'undefined', 'self', 'if', 'else'
])

/** Split a raw word on case / digit / separator boundaries. */
function splitWord(word: string): string[] {
  // Normalize separators to spaces first.
  const separated = word.replace(/[_\-./\\:@#$%^&*()[\]{}<>+=~`'"!?,;|]+/g, ' ')
  const out: string[] = []
  for (const piece of separated.split(/\s+/)) {
    if (!piece) continue
    // Insert boundaries: camelCase -> camel Case, HTTPResponse -> HTTP Response,
    // letters<->digits.
    const withBoundaries = piece
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
      .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    for (const sub of withBoundaries.split(/\s+/)) {
      if (sub) out.push(sub)
    }
  }
  return out
}

/** Light stemming: strip common suffixes when the stem stays >= 3 chars. */
export function stem(token: string): string {
  if (token.length < 4) return token
  if (token.endsWith('ies') && token.length - 3 >= 3) return token.slice(0, -3) + 'y'
  if (token.endsWith('ing') && token.length - 3 >= 3) return token.slice(0, -3)
  if (token.endsWith('ed') && token.length - 2 >= 3) return token.slice(0, -2)
  if (token.endsWith('es') && token.length - 2 >= 3) return token.slice(0, -2)
  if (token.endsWith('s') && !token.endsWith('ss') && token.length - 1 >= 3) {
    return token.slice(0, -1)
  }
  return token
}

/**
 * Tokenize text into normalized, stemmed tokens.
 * @param opts.stemming apply light stemming (default true)
 */
export function tokenize(text: string, opts: { stemming?: boolean } = {}): string[] {
  const stemming = opts.stemming !== false
  const out: string[] = []
  const rawWords = (text || '').match(/[A-Za-z0-9_\-./\\@#]+/g) || []
  for (const raw of rawWords) {
    for (const piece of splitWord(raw)) {
      const lower = piece.toLowerCase()
      if (lower.length <= 1) continue
      if (STOPWORDS.has(lower)) continue
      out.push(stemming ? stem(lower) : lower)
    }
  }
  return out
}

/** Tokenize a repo-relative path into weighted path segment tokens. */
export function tokenizePath(relPath: string): string[] {
  return tokenize(relPath.replace(/\.[^.]+$/, ''))
}

export { STOPWORDS }
