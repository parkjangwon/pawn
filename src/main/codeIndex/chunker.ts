/**
 * Language-aware source chunker.
 *
 * Splits a source file into semantically-meaningful chunks by detecting
 * top-level declaration starts per language. Oversized declarations are split
 * into overlapping windows; tiny adjacent pieces are merged. Markdown is split
 * by headings, and unknown text by fixed-size line windows.
 */

export type ChunkKind = 'function' | 'class' | 'type' | 'section' | 'block'

export interface Chunk {
  path: string
  startLine: number // 1-based
  endLine: number // 1-based inclusive
  symbol?: string
  kind?: ChunkKind
  text: string
}

const WINDOW = 80
const OVERLAP = 10
const MERGE_MAX = 60

export type Language =
  | 'ts' | 'js' | 'python' | 'go' | 'rust' | 'java' | 'c' | 'swift'
  | 'ruby' | 'php' | 'markdown' | 'text'

const EXT_LANG: Record<string, Language> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  py: 'python', pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java', kt: 'java', kts: 'java',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', hh: 'c', cs: 'c',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown'
}

export function languageForPath(path: string): Language {
  const m = /\.([^.]+)$/.exec(path)
  const ext = m ? m[1].toLowerCase() : ''
  return EXT_LANG[ext] || 'text'
}

interface DeclMatch {
  symbol?: string
  kind?: ChunkKind
}

/** Per-language detection of a top-level declaration on a given (trimmed) line. */
function matchDecl(lang: Language, line: string): DeclMatch | null {
  const t = line.trim()
  if (!t) return null
  let m: RegExpExecArray | null

  if (lang === 'ts' || lang === 'js') {
    m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z0-9_$]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    m = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'class' }
    m = /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'type' }
    m = /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'type' }
    m = /^(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'type' }
    // const foo = ( ... ) => / const foo = function / async arrow
    m = /^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z0-9_$]+\s*=>)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    return null
  }

  if (lang === 'python') {
    m = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    m = /^class\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'class' }
    return null
  }

  if (lang === 'go') {
    m = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    m = /^type\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'type' }
    return null
  }

  if (lang === 'rust') {
    m = /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    m = /^(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'class' }
    m = /^(?:pub\s+)?enum\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'type' }
    m = /^(?:pub\s+)?trait\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'type' }
    m = /^impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z0-9_:<>]+\s+for\s+)?([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'class' }
    return null
  }

  if (lang === 'java' || lang === 'c' || lang === 'swift') {
    m = /^(?:public\s+|private\s+|protected\s+|internal\s+|open\s+|final\s+|abstract\s+|static\s+|sealed\s+)*(?:class|interface|struct|enum|protocol)\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'class' }
    m = /^(?:public\s+|private\s+|internal\s+|static\s+|override\s+)*func\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    return null
  }

  if (lang === 'ruby') {
    m = /^def\s+([A-Za-z0-9_?!]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    m = /^(?:class|module)\s+([A-Za-z0-9_:]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'class' }
    return null
  }

  if (lang === 'php') {
    m = /^(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*function\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'function' }
    m = /^(?:abstract\s+|final\s+)*(?:class|interface|trait)\s+([A-Za-z0-9_]+)/.exec(t)
    if (m) return { symbol: m[1], kind: 'class' }
    return null
  }

  return null
}

const DOC_COMMENT = /^\s*(\/\/|\/\*|\*|#|--|"""|''')/

/** Count how many preceding lines form a doc comment / decorator block. */
function docCommentStart(lines: string[], declLine: number): number {
  let start = declLine
  for (let i = declLine - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (t === '') break
    if (DOC_COMMENT.test(lines[i]) || t.startsWith('@')) {
      start = i
    } else {
      break
    }
  }
  return start
}

function windowize(
  path: string,
  lines: string[],
  from: number,
  to: number,
  symbol: string | undefined,
  kind: ChunkKind | undefined
): Chunk[] {
  const total = to - from + 1
  if (total <= WINDOW) {
    return [makeChunk(path, lines, from, to, symbol, kind)]
  }
  const out: Chunk[] = []
  let start = from
  while (start <= to) {
    const end = Math.min(start + WINDOW - 1, to)
    out.push(makeChunk(path, lines, start, end, symbol, kind))
    if (end >= to) break
    start = end - OVERLAP + 1
  }
  return out
}

function makeChunk(
  path: string,
  lines: string[],
  from: number,
  to: number,
  symbol: string | undefined,
  kind: ChunkKind | undefined
): Chunk {
  return {
    path,
    startLine: from + 1,
    endLine: to + 1,
    symbol,
    kind,
    text: lines.slice(from, to + 1).join('\n')
  }
}

function chunkByLineWindows(path: string, lines: string[], size = MERGE_MAX): Chunk[] {
  const out: Chunk[] = []
  for (let start = 0; start < lines.length; start += size) {
    const end = Math.min(start + size - 1, lines.length - 1)
    out.push(makeChunk(path, lines, start, end, undefined, 'block'))
  }
  return out.length ? out : [makeChunk(path, lines, 0, Math.max(0, lines.length - 1), undefined, 'block')]
}

function chunkMarkdown(path: string, lines: string[]): Chunk[] {
  const out: Chunk[] = []
  let start = 0
  let symbol: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{1,6}\s+(.*)$/.exec(lines[i])
    if (m && i > start) {
      out.push(makeChunk(path, lines, start, i - 1, symbol, 'section'))
      start = i
      symbol = m[1].trim()
    } else if (m && i === start) {
      symbol = m[1].trim()
    }
  }
  out.push(makeChunk(path, lines, start, Math.max(start, lines.length - 1), symbol, 'section'))
  return out
}

/** Merge adjacent tiny declaration chunks (no symbol / small) up to MERGE_MAX. */
function mergeSmall(chunks: Chunk[]): Chunk[] {
  const out: Chunk[] = []
  for (const c of chunks) {
    const last = out[out.length - 1]
    const cLines = c.endLine - c.startLine + 1
    if (
      last &&
      !last.symbol &&
      !c.symbol &&
      last.endLine - last.startLine + 1 + cLines <= MERGE_MAX &&
      c.startLine === last.endLine + 1
    ) {
      last.endLine = c.endLine
      last.text = last.text + '\n' + c.text
      last.kind = 'block'
    } else {
      out.push({ ...c })
    }
  }
  return out
}

/** Chunk a source file's raw text. */
export function chunkFile(path: string, content: string, lang?: Language): Chunk[] {
  const language = lang || languageForPath(path)
  const rawLines = content.split('\n')
  // Drop a trailing empty line artifact from split.
  const lines = rawLines.length > 1 && rawLines[rawLines.length - 1] === ''
    ? rawLines.slice(0, -1)
    : rawLines

  if (lines.length === 0) return []

  if (language === 'markdown') return chunkMarkdown(path, lines)
  if (language === 'text') return chunkByLineWindows(path, lines)

  // Find declaration boundaries.
  const decls: Array<{ line: number; symbol?: string; kind?: ChunkKind }> = []
  for (let i = 0; i < lines.length; i++) {
    const d = matchDecl(language, lines[i])
    if (d) {
      const start = docCommentStart(lines, i)
      decls.push({ line: start, symbol: d.symbol, kind: d.kind })
    }
  }

  if (decls.length === 0) {
    return chunkByLineWindows(path, lines)
  }

  const chunks: Chunk[] = []
  // Preamble before the first declaration.
  if (decls[0].line > 0) {
    chunks.push(makeChunk(path, lines, 0, decls[0].line - 1, undefined, 'block'))
  }
  for (let i = 0; i < decls.length; i++) {
    const from = decls[i].line
    const to = i + 1 < decls.length ? decls[i + 1].line - 1 : lines.length - 1
    if (to < from) continue
    for (const w of windowize(path, lines, from, to, decls[i].symbol, decls[i].kind)) {
      chunks.push(w)
    }
  }
  return mergeSmall(chunks)
}
