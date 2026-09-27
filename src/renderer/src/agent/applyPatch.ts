/**
 * Pure TypeScript implementation of the OpenAI Codex "apply_patch" (V4A) diff
 * format that GPT models are trained to emit.
 *
 * This module is intentionally free of any I/O or filesystem access: it only
 * parses patch text and computes the result of applying update chunks to a
 * string. The caller is responsible for resolving/validating paths and reading
 * and writing files.
 *
 * V4A format overview:
 *
 *   *** Begin Patch
 *   *** Add File: path/to/new.py
 *   +line one
 *   +line two
 *   *** Delete File: path/to/old.py
 *   *** Update File: path/to/file.py
 *   *** Move to: path/to/renamed.py        (optional, right after Update File)
 *   @@ class Foo
 *   @@     def bar(self):                  (zero or more @@ context-header lines)
 *    context line
 *   -removed line
 *   +added line
 *    context line
 *   @@                                      (bare @@ starts a new chunk)
 *   *** End of File                         (optional; chunk matches at EOF)
 *   *** End Patch
 */

export type PatchOp =
  | { type: 'add'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; moveTo?: string; chunks: PatchChunk[] }

export interface PatchChunk {
  /** Ordered @@ context-header lines that narrow the search region. */
  contexts: string[]
  /** Original lines to be removed/matched (context + removed lines). */
  oldLines: string[]
  /** Replacement lines (context + added lines). */
  newLines: string[]
  /** When true, the chunk must match at the end of the file. */
  isEndOfFile: boolean
}

type ParseResult = { ok: true; ops: PatchOp[] } | { ok: false; error: string }
type ApplyResult = { ok: true; content: string } | { ok: false; error: string }

const BEGIN_PATCH = '*** Begin Patch'
const END_PATCH = '*** End Patch'
const ADD_FILE = '*** Add File: '
const DELETE_FILE = '*** Delete File: '
const UPDATE_FILE = '*** Update File: '
const MOVE_TO = '*** Move to: '
const END_OF_FILE = '*** End of File'

// ---------------------------------------------------------------------------
// Unwrapping helpers
// ---------------------------------------------------------------------------

/**
 * Strip common wrappers models add around a patch:
 *   - a surrounding ``` / ```patch fence
 *   - a shell heredoc:  apply_patch <<'EOF' ... EOF
 *   - a quoted arg:      apply_patch "..."  /  apply_patch '...'
 * Returns the inner patch text (still may have leading/trailing whitespace).
 */
function unwrap(text: string): string {
  let s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  s = s.trim()

  // Strip a surrounding code fence (```lang ... ```).
  if (s.indexOf('```') === 0) {
    const firstNewline = s.indexOf('\n')
    if (firstNewline !== -1) {
      const closing = s.lastIndexOf('```')
      if (closing > firstNewline) {
        s = s.slice(firstNewline + 1, closing)
      } else {
        s = s.slice(firstNewline + 1)
      }
    }
    s = s.trim()
  }

  // Strip a heredoc: <command> <<'EOF' ... EOF  (or <<EOF / <<"EOF").
  const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n?\2\s*$/
  const hd = heredoc.exec(s)
  if (hd) {
    s = hd[3].trim()
  } else {
    // Strip `apply_patch "..."` or `apply_patch '...'` single-arg form.
    const quoted = /^[A-Za-z_./-]*apply_patch\s+(['"])([\s\S]*)\1\s*$/
    const q = quoted.exec(s)
    if (q) {
      s = q[2].trim()
    } else {
      // Strip a bare `apply_patch` command prefix on the first line.
      const bare = /^[A-Za-z_./-]*apply_patch[^\n]*\n/
      if (bare.test(s) && s.indexOf(BEGIN_PATCH) > 0) {
        // Only drop the prefix line if Begin Patch is not on it.
        const nl = s.indexOf('\n')
        const firstLine = s.slice(0, nl)
        if (firstLine.indexOf(BEGIN_PATCH) === -1) {
          s = s.slice(nl + 1).trim()
        }
      }
    }
  }

  return s.trim()
}

/** Split into lines without a trailing empty element from a final newline. */
function toLines(s: string): string[] {
  const lines = s.split('\n')
  return lines
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Quick, cheap heuristic: does this text look like an apply_patch payload? */
export function looksLikePatch(text: string): boolean {
  if (!text) return false
  const s = unwrap(text)
  if (s.indexOf(BEGIN_PATCH) !== -1) return true
  // Also accept the common headers even if Begin Patch got dropped.
  return (
    s.indexOf(ADD_FILE) !== -1 ||
    s.indexOf(UPDATE_FILE) !== -1 ||
    s.indexOf(DELETE_FILE) !== -1
  )
}

function isSectionHeader(line: string): boolean {
  return (
    line.indexOf(ADD_FILE) === 0 ||
    line.indexOf(DELETE_FILE) === 0 ||
    line.indexOf(UPDATE_FILE) === 0 ||
    line === END_PATCH ||
    line.indexOf(END_PATCH) === 0
  )
}

/**
 * Parse a V4A patch into a list of operations.
 * Tolerates: fences, heredoc/quoted shell wrappers, CRLF, a missing final
 * `*** End Patch`, blank lines inside update chunks, and update-hunk lines that
 * are missing their leading marker (treated as context).
 */
export function parsePatch(text: string): ParseResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'Empty patch: expected "*** Begin Patch".' }
  }

  const body = unwrap(text)
  const lines = toLines(body)

  // Locate the Begin Patch marker.
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === BEGIN_PATCH) {
      start = i
      break
    }
  }
  if (start === -1) {
    return {
      ok: false,
      error: 'Missing "*** Begin Patch" header at the start of the patch.'
    }
  }

  const ops: PatchOp[] = []
  const seenPaths = new Set<string>()
  let i = start + 1
  let sawEndPatch = false

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw

    if (line.trim() === END_PATCH || line.trim() === END_PATCH.trim()) {
      sawEndPatch = true
      i++
      break
    }

    if (line.indexOf(ADD_FILE) === 0) {
      const path = line.slice(ADD_FILE.length).trim()
      if (!path) {
        return { ok: false, error: `Line ${i + 1}: "*** Add File:" is missing a path.` }
      }
      if (seenPaths.has(path)) {
        return { ok: false, error: `Duplicate path in patch: "${path}" (line ${i + 1}).` }
      }
      seenPaths.add(path)
      i++
      const contentLines: string[] = []
      while (i < lines.length) {
        const l = lines[i]
        if (isSectionHeader(l)) break
        if (l.length === 0) {
          // A truly empty line inside an Add block is ambiguous; models
          // occasionally emit it for a blank added line. Treat as blank add.
          contentLines.push('')
          i++
          continue
        }
        if (l.charAt(0) !== '+') {
          return {
            ok: false,
            error: `Line ${i + 1}: Add File "${path}" content lines must start with "+", got: ${JSON.stringify(
              l
            )}.`
          }
        }
        contentLines.push(l.slice(1))
        i++
      }
      ops.push({ type: 'add', path, content: contentLines.join('\n') + '\n' })
      continue
    }

    if (line.indexOf(DELETE_FILE) === 0) {
      const path = line.slice(DELETE_FILE.length).trim()
      if (!path) {
        return { ok: false, error: `Line ${i + 1}: "*** Delete File:" is missing a path.` }
      }
      if (seenPaths.has(path)) {
        return { ok: false, error: `Duplicate path in patch: "${path}" (line ${i + 1}).` }
      }
      seenPaths.add(path)
      ops.push({ type: 'delete', path })
      i++
      continue
    }

    if (line.indexOf(UPDATE_FILE) === 0) {
      const path = line.slice(UPDATE_FILE.length).trim()
      if (!path) {
        return { ok: false, error: `Line ${i + 1}: "*** Update File:" is missing a path.` }
      }
      if (seenPaths.has(path)) {
        return { ok: false, error: `Duplicate path in patch: "${path}" (line ${i + 1}).` }
      }
      seenPaths.add(path)
      i++

      let moveTo: string | undefined
      if (i < lines.length && lines[i].indexOf(MOVE_TO) === 0) {
        moveTo = lines[i].slice(MOVE_TO.length).trim()
        if (!moveTo) {
          return { ok: false, error: `Line ${i + 1}: "*** Move to:" is missing a path.` }
        }
        i++
      }

      const chunksResult = parseUpdateChunks(lines, i, path)
      if (!chunksResult.ok) return { ok: false, error: chunksResult.error }
      if (chunksResult.chunks.length === 0) {
        return {
          ok: false,
          error: `Update File "${path}" has no change chunks (expected at least one @@ header or +/- line).`
        }
      }
      ops.push({ type: 'update', path, moveTo, chunks: chunksResult.chunks })
      i = chunksResult.nextIndex
      continue
    }

    // Unknown / stray line. Blank lines between ops are tolerated.
    if (line.trim() === '') {
      i++
      continue
    }

    return {
      ok: false,
      error: `Line ${i + 1}: expected a section header (Add/Delete/Update File) or "*** End Patch", got: ${JSON.stringify(
        line
      )}.`
    }
  }

  if (ops.length === 0) {
    return { ok: false, error: 'Patch contains no operations.' }
  }

  // A missing "*** End Patch" is tolerated as long as everything parsed.
  void sawEndPatch

  return { ok: true, ops }
}

interface ChunksParse {
  ok: true
  chunks: PatchChunk[]
  nextIndex: number
}
interface ChunksParseErr {
  ok: false
  error: string
}

function parseUpdateChunks(
  lines: string[],
  startIndex: number,
  path: string
): ChunksParse | ChunksParseErr {
  const chunks: PatchChunk[] = []
  let i = startIndex

  // Hold the in-progress chunk inside an object field. Using a field (rather
  // than a bare mutable captured by closures) keeps its type as
  // `PatchChunk | null` for control-flow analysis instead of narrowing to
  // `never` after reassignments inside helper closures.
  const state: { cur: PatchChunk | null } = { cur: null }
  const flush = (): void => {
    const c = state.cur
    if (c && (c.contexts.length > 0 || c.oldLines.length > 0 || c.newLines.length > 0)) {
      chunks.push(c)
    }
    state.cur = null
  }
  const ensure = (): PatchChunk => {
    let c = state.cur
    if (!c) {
      c = { contexts: [], oldLines: [], newLines: [], isEndOfFile: false }
      state.cur = c
    }
    return c
  }

  while (i < lines.length) {
    const l = lines[i]

    if (isSectionHeader(l)) {
      break
    }

    if (l.indexOf(END_OF_FILE) === 0) {
      const c = ensure()
      c.isEndOfFile = true
      i++
      continue
    }

    if (l.indexOf('@@') === 0) {
      // A bare "@@" (only whitespace after) starts a new chunk.
      const rest = l.slice(2)
      if (rest.trim() === '') {
        flush()
      } else {
        // Context header narrows the region for the (possibly new) chunk.
        // If the current chunk already has body lines, start a fresh chunk.
        const existing = state.cur
        if (existing && (existing.oldLines.length > 0 || existing.newLines.length > 0)) {
          flush()
        }
        const c = ensure()
        c.contexts.push(rest.replace(/^\s/, ''))
      }
      i++
      continue
    }

    // Body line of a hunk.
    const c = ensure()
    if (l.length === 0) {
      // Blank line inside a chunk => a context line with empty content.
      c.oldLines.push('')
      c.newLines.push('')
      i++
      continue
    }
    const marker = l.charAt(0)
    if (marker === ' ') {
      const body = l.slice(1)
      c.oldLines.push(body)
      c.newLines.push(body)
    } else if (marker === '-') {
      c.oldLines.push(l.slice(1))
    } else if (marker === '+') {
      c.newLines.push(l.slice(1))
    } else {
      // Missing leading marker: models sometimes drop the leading space.
      // Treat the whole line as a context line.
      c.oldLines.push(l)
      c.newLines.push(l)
    }
    i++
  }

  flush()
  void path
  return { ok: true, chunks, nextIndex: i }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const FANCY_DASHES = ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212']
const CURLY_QUOTES: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"'
}
// Unicode spaces: NBSP, NNBSP, various width spaces, etc.
const UNICODE_SPACES = [
  '\u00A0',
  '\u2000',
  '\u2001',
  '\u2002',
  '\u2003',
  '\u2004',
  '\u2005',
  '\u2006',
  '\u2007',
  '\u2008',
  '\u2009',
  '\u200A',
  '\u202F',
  '\u205F',
  '\u3000',
  '\uFEFF'
]

/** Normalize fancy unicode dashes/quotes/spaces to ASCII, then trim. */
function unicodeNormalize(s: string): string {
  let out = ''
  for (let k = 0; k < s.length; k++) {
    const ch = s.charAt(k)
    if (FANCY_DASHES.indexOf(ch) !== -1) {
      out += '-'
    } else if (Object.prototype.hasOwnProperty.call(CURLY_QUOTES, ch)) {
      out += CURLY_QUOTES[ch]
    } else if (UNICODE_SPACES.indexOf(ch) !== -1) {
      out += ' '
    } else {
      out += ch
    }
  }
  return out
}

function rtrim(s: string): string {
  return s.replace(/[ \t]+$/, '')
}
function bothTrim(s: string): string {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
}

/** Does `fileLine` match `patLine` under the given fuzz pass (0..3)? */
function lineMatches(fileLine: string, patLine: string, pass: number): boolean {
  if (pass === 0) return fileLine === patLine
  if (pass === 1) return rtrim(fileLine) === rtrim(patLine)
  if (pass === 2) return bothTrim(fileLine) === bothTrim(patLine)
  // pass 3: unicode-normalized + trimmed.
  return bothTrim(unicodeNormalize(fileLine)) === bothTrim(unicodeNormalize(patLine))
}

/**
 * Find `seq` as a contiguous run in `fileLines` at/after `from`. Tries the
 * matching passes in order and returns the first index found. If `preferEnd`,
 * search anchored to the end of the file first.
 */
function seekSequence(
  fileLines: string[],
  seq: string[],
  from: number,
  preferEnd: boolean
): number {
  if (seq.length === 0) return from
  const maxStart = fileLines.length - seq.length
  if (maxStart < from) {
    // Only possible if preferEnd handling for empty; return not found.
    if (!preferEnd) return -1
  }

  for (let pass = 0; pass <= 3; pass++) {
    if (preferEnd) {
      const endStart = fileLines.length - seq.length
      if (endStart >= from && matchesAt(fileLines, seq, endStart, pass)) {
        return endStart
      }
    }
    for (let start = from; start <= fileLines.length - seq.length; start++) {
      if (matchesAt(fileLines, seq, start, pass)) {
        return start
      }
    }
  }
  return -1
}

function matchesAt(fileLines: string[], seq: string[], start: number, pass: number): boolean {
  if (start < 0 || start + seq.length > fileLines.length) return false
  for (let j = 0; j < seq.length; j++) {
    if (!lineMatches(fileLines[start + j], seq[j], pass)) return false
  }
  return true
}

/** Find a single context header line at/after `from`, fuzzy. Returns index. */
function seekHeader(fileLines: string[], header: string, from: number): number {
  for (let pass = 0; pass <= 3; pass++) {
    for (let idx = from; idx < fileLines.length; idx++) {
      if (lineMatches(fileLines[idx], header, pass)) return idx
    }
  }
  return -1
}

function detectCrlf(original: string): boolean {
  const crlf = (original.match(/\r\n/g) || []).length
  const bareLf = (original.match(/(?:^|[^\r])\n/g) || []).length
  return crlf > 0 && crlf >= bareLf
}

/**
 * Apply a series of update chunks to `original`, returning the new content.
 * Preserves the original newline style and trailing-newline presence.
 */
export function applyChunks(original: string, chunks: PatchChunk[], path?: string): ApplyResult {
  const label = path ? ` in "${path}"` : ''
  const usesCrlf = detectCrlf(original)
  const hadTrailingNewline = original.length > 0 && /\r?\n$/.test(original)

  // Normalize to LF and split into working lines (drop the trailing empty
  // element caused by a final newline so line indices map to real lines).
  const normalized = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let fileLines = normalized.split('\n')
  if (hadTrailingNewline && fileLines.length > 0 && fileLines[fileLines.length - 1] === '') {
    fileLines = fileLines.slice(0, fileLines.length - 1)
  }

  let cursor = 0

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]

    // 1) Walk the context headers in order, advancing the cursor.
    for (let hi = 0; hi < chunk.contexts.length; hi++) {
      const header = chunk.contexts[hi]
      const at = seekHeader(fileLines, header, cursor)
      if (at === -1) {
        return {
          ok: false,
          error:
            `Could not find context header${label}: ${JSON.stringify(header)}. ` +
            `Re-read the file and copy the exact current lines.`
        }
      }
      cursor = at + 1
    }

    // 2) Pure insertion: empty oldLines => insert at the cursor (after headers)
    //    or at end of file if requested / no header context.
    if (chunk.oldLines.length === 0) {
      const insertAt = chunk.isEndOfFile ? fileLines.length : cursor
      const before = fileLines.slice(0, insertAt)
      const after = fileLines.slice(insertAt)
      fileLines = before.concat(chunk.newLines, after)
      cursor = insertAt + chunk.newLines.length
      continue
    }

    // 3) Locate oldLines as a contiguous sequence at/after the cursor.
    const at = seekSequence(fileLines, chunk.oldLines, cursor, chunk.isEndOfFile)
    if (at === -1) {
      const preview = chunk.oldLines
        .slice(0, 3)
        .map((l) => JSON.stringify(l))
        .join(', ')
      return {
        ok: false,
        error:
          `Could not apply chunk${label}: expected lines not found (starting with ${preview}). ` +
          `Re-read the file and regenerate the patch against its current contents.`
      }
    }

    const before = fileLines.slice(0, at)
    const after = fileLines.slice(at + chunk.oldLines.length)
    fileLines = before.concat(chunk.newLines, after)
    cursor = at + chunk.newLines.length
  }

  let result = fileLines.join('\n')
  if (hadTrailingNewline) {
    result += '\n'
  }
  if (usesCrlf) {
    result = result.replace(/\n/g, '\r\n')
  }
  return { ok: true, content: result }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** Render a compact one-line summary, e.g. "A new.py, M file.py -> renamed.py, D old.py". */
export function summarizeOps(ops: PatchOp[]): string {
  const parts: string[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (op.type === 'add') {
      parts.push(`A ${op.path}`)
    } else if (op.type === 'delete') {
      parts.push(`D ${op.path}`)
    } else {
      if (op.moveTo && op.moveTo !== op.path) {
        parts.push(`M ${op.path} -> ${op.moveTo}`)
      } else {
        parts.push(`M ${op.path}`)
      }
    }
  }
  return parts.join(', ')
}
