/**
 * Minimal gitignore-style matcher for agent walk/search.
 * Supports: blank/comments, trailing slash (dirs), leading !, **, *, ?,
 * and simple nested patterns. Not a full git port — good enough for coding agents.
 */

export type IgnoreRule = {
  negate: boolean
  dirOnly: boolean
  anchored: boolean
  test: (relPath: string, isDirectory: boolean) => boolean
}

function globToRegExp(pattern: string): RegExp {
  let i = 0
  let out = ''
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 3
        } else {
          out += '.*'
          i += 2
        }
      } else {
        out += '[^/]*'
        i++
      }
    } else if (c === '?') {
      out += '[^/]'
      i++
    } else if (c === '[') {
      let j = i + 1
      let cls = '['
      if (pattern[j] === '!' || pattern[j] === '^') {
        cls += '^'
        j++
      }
      while (j < pattern.length && pattern[j] !== ']') {
        cls += pattern[j] === '\\' ? pattern[j++] + (pattern[j] || '') : pattern[j]
        j++
      }
      cls += ']'
      out += cls
      i = j + 1
    } else if ('+|(){}^$.'.includes(c)) {
      out += '\\' + c
      i++
    } else {
      out += c
      i++
    }
  }
  return new RegExp(`^${out}$`)
}

export function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine
    if (!line || line.startsWith('#')) continue
    if (!line.endsWith('\\ ')) line = line.replace(/ +$/, '')
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    }
    if (!line) continue
    let dirOnly = false
    if (line.endsWith('/') && line.length > 1) {
      dirOnly = true
      line = line.slice(0, -1)
    }
    let anchored = false
    if (line.startsWith('/')) {
      anchored = true
      line = line.slice(1)
    }
    const re = globToRegExp(line)
    rules.push({
      negate,
      dirOnly,
      anchored,
      test: (relPath, isDirectory) => {
        if (dirOnly && !isDirectory) return false
        const norm = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
        if (anchored) return re.test(norm)
        if (re.test(norm)) return true
        const parts = norm.split('/')
        for (let i = 0; i < parts.length; i++) {
          const suffix = parts.slice(i).join('/')
          if (re.test(suffix)) return true
          if (re.test(parts[i])) return true
        }
        return false
      }
    })
  }
  return rules
}

export function isIgnored(relPath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  const norm = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const candidates: Array<{ path: string; isDir: boolean }> = [{ path: norm, isDir: isDirectory }]
  const parts = norm.split('/').filter(Boolean)
  for (let i = 1; i < parts.length; i++) {
    candidates.push({ path: parts.slice(0, i).join('/'), isDir: true })
  }
  let ignored = false
  for (const rule of rules) {
    for (const c of candidates) {
      if (rule.test(c.path, c.isDir)) {
        ignored = !rule.negate
      }
    }
  }
  return ignored
}

export function compileIgnoreFiles(contents: Array<string | null | undefined>): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const text of contents) {
    if (text) rules.push(...parseGitignore(text))
  }
  return rules
}
