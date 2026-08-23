/**
 * Structural + lightweight syntax verification after edits.
 * No full LSP — balance checks, string/template safety, common syntax traps,
 * and optional TypeScript transpile when the host has `typescript` available.
 */

export type EditVerifyResult = {
  ok: boolean
  warnings: string[]
}

function countBalanced(src: string, open: string, close: string): number {
  let n = 0
  let inStr: '"' | "'" | '`' | null = null
  let esc = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]
    if (inLineComment) {
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\' && inStr !== '`') {
        esc = true
        continue
      }
      // template literal: skip ${...} roughly
      if (inStr === '`' && c === '$' && next === '{') {
        i++
        let depth = 1
        i++
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++
          else if (src[i] === '}') depth--
          i++
        }
        i--
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (c === '/' && next === '*') {
      inBlockComment = true
      i++
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

function unclosedString(src: string): string | null {
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
    if (c === '"' || c === "'" || c === '`') inStr = c
  }
  return inStr ? `unclosed string starting with ${inStr}` : null
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

function checkJsCommonTraps(src: string, warnings: string[]): void {
  // orphaned catch/else
  if (/^\s*(catch|else|finally)\b/m.test(src) && !/\btry\b/.test(src) && !/\bif\b/.test(src)) {
    // soft signal only when file is tiny fragment
  }
  // double commas in imports
  if (/import\s*\{[^}]*,,/.test(src)) warnings.push('double comma in import list')
  // export without name
  if (/\bexport\s*;\s*$/m.test(src)) warnings.push('bare export; looks truncated')
  // unmatched JSX-ish closing tags (very light)
  const openTags = (src.match(/<[A-Z][A-Za-z0-9]*[\s>]/g) || []).length
  const closeTags = (src.match(/<\/[A-Z][A-Za-z0-9]*>/g) || []).length
  if (openTags > 0 && closeTags > 0 && Math.abs(openTags - closeTags) > 3) {
    warnings.push(`possible JSX tag imbalance (open~${openTags} close~${closeTags})`)
  }
}

function checkPyCommonTraps(content: string, warnings: string[]): void {
  const lines = content.split('\n')
  let hasTab = false
  let hasSpaceIndent = false
  for (const l of lines) {
    if (/^\t+/.test(l)) hasTab = true
    if (/^ +/.test(l)) hasSpaceIndent = true
    if (/:\s*\S+/.test(l) && /:\s*[^#\s]/.test(l) && !/lambda|dict|slice|True|False|None|["']/.test(l)) {
      // pass — too noisy
    }
  }
  if (hasTab && hasSpaceIndent) warnings.push('mixed tabs and spaces in indentation')
  // unclosed triple quotes
  const tripleDouble = (content.match(/"""/g) || []).length
  const tripleSingle = (content.match(/'''/g) || []).length
  if (tripleDouble % 2 !== 0) warnings.push('unclosed """ string')
  if (tripleSingle % 2 !== 0) warnings.push("unclosed ''' string")
}

/**
 * Best-effort TS/JS parse via optional typescript package (devDependency of many projects).
 * Never required — fails open.
 */
function tryTypescriptSyntaxCheck(path: string, content: string): string | null {
  if (!/\.tsx?$/i.test(path)) return null
  try {
    // Dynamic import not available sync; use require if bundled, else skip.
    // electron-vite renderer may not resolve typescript — guard carefully.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ts = (globalThis as { require?: (m: string) => unknown }).require?.('typescript') as
      | {
          transpileModule: (
            c: string,
            o: { compilerOptions: Record<string, unknown>; reportDiagnostics?: boolean; fileName?: string }
          ) => { diagnostics?: Array<{ messageText: string | { messageText: string } }> }
          ModuleKind: { ESNext: number }
          ScriptTarget: { ES2020: number }
          Jsx: { React: number }
        }
      | undefined
    if (!ts?.transpileModule) return null
    const isTsx = /\.tsx$/i.test(path)
    const out = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        jsx: isTsx ? ts.Jsx.React : undefined,
        noEmit: true
      },
      reportDiagnostics: true,
      fileName: path
    })
    const diags = out.diagnostics || []
    if (!diags.length) return null
    const first = diags[0]
    const msg =
      typeof first.messageText === 'string'
        ? first.messageText
        : first.messageText?.messageText || 'syntax error'
    return `typescript: ${msg}`
  } catch {
    return null
  }
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
    const us = unclosedString(src)
    if (us) warnings.push(us)
    if (lang === 'js') checkJsCommonTraps(src, warnings)
    const tsWarn = tryTypescriptSyntaxCheck(path, content)
    if (tsWarn) warnings.push(tsWarn)
  }

  if (lang === 'py') {
    checkPyCommonTraps(content, warnings)
  }

  // Trailing garbage often means truncated tool args
  if (/\uFFFD/.test(content)) warnings.push('replacement character U+FFFD present (possible encoding damage)')

  // Truncated file ending mid-token
  if (/[,{(]\s*$/.test(content.trim()) && content.length > 40) {
    warnings.push('file ends with open delimiter — possible truncated write')
  }

  return { ok: warnings.length === 0, warnings }
}

export function formatVerifyNote(path: string, result: EditVerifyResult): string {
  if (result.ok || !result.warnings.length) return ''
  return (
    `\n\n[structure_check: syntax warnings for ${path}]\n` +
    result.warnings.map((w) => `- ${w}`).join('\n') +
    `\n(Action required: The file was saved, but potential syntax/structure defects were detected above. Please review and fix these issues in your next edit tool call before concluding the turn.)`
  )
}
