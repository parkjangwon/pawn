/**
 * Lightweight structural verification after edits (OpenCode-inspired).
 * No full language servers — balance/heuristic checks only (free, fast).
 */

export type EditVerifyResult = {
  ok: boolean
  warnings: string[]
}

function countBalanced(src: string, open: string, close: string): number {
  let n = 0
  let inStr: '"' | "'" | '`' | null = null
  let esc = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\' && inStr !== '`') {
        esc = true
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === open) n++
    else if (c === close) n--
  }
  return n
}

function stripCommentsRough(src: string, lang: 'js' | 'py' | 'other'): string {
  if (lang === 'py') {
    return src
      .split('\n')
      .map((l) => {
        const i = l.indexOf('#')
        return i >= 0 ? l.slice(0, i) : l
      })
      .join('\n')
  }
  if (lang === 'js') {
    // crude: drop // lines and /* */ blocks
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => {
        const i = l.indexOf('//')
        return i >= 0 ? l.slice(0, i) : l
      })
      .join('\n')
  }
  return src
}

function langOf(path: string): 'js' | 'py' | 'other' {
  if (/\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/i.test(path)) return 'js'
  if (/\.py$/i.test(path)) return 'py'
  return 'other'
}

/**
 * Return warnings for likely broken structure. Never throws.
 * Does not block the write — callers append warnings to tool result.
 */
export function verifyEditedSource(path: string, content: string): EditVerifyResult {
  const warnings: string[] = []
  if (!content || content.length > 2_000_000) return { ok: true, warnings }

  const lang = langOf(path)
  const src = stripCommentsRough(content, lang)

  if (lang === 'js' || lang === 'other') {
    const braces = countBalanced(src, '{', '}')
    const parens = countBalanced(src, '(', ')')
    const brackets = countBalanced(src, '[', ']')
    if (braces !== 0) warnings.push(`unbalanced { } (delta=${braces})`)
    if (parens !== 0) warnings.push(`unbalanced ( ) (delta=${parens})`)
    if (brackets !== 0) warnings.push(`unbalanced [ ] (delta=${brackets})`)
  }

  if (lang === 'py') {
    // Indentation: mix tabs/spaces
    const lines = content.split('\n')
    let hasTab = false
    let hasSpaceIndent = false
    for (const l of lines) {
      if (/^\t+/.test(l)) hasTab = true
      if (/^ +/.test(l)) hasSpaceIndent = true
    }
    if (hasTab && hasSpaceIndent) warnings.push('mixed tabs and spaces in indentation')
  }

  // Trailing garbage often means truncated tool args
  if (/\uFFFD/.test(content)) warnings.push('replacement character U+FFFD present (possible encoding damage)')

  return { ok: warnings.length === 0, warnings }
}

export function formatVerifyNote(path: string, result: EditVerifyResult): string {
  if (result.ok) return ''
  return (
    `\n\n[structure_check: warnings for ${path}]\n` +
    result.warnings.map((w) => `- ${w}`).join('\n') +
    `\nRe-read the file and fix before finishing.`
  )
}
