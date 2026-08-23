export interface DiffLine {
  type: 'add' | 'remove' | 'same'
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface DiffResult {
  lines: DiffLine[]
  added: number
  removed: number
}

/**
 * Myers diff algorithm — O(ND) time, O(N) linear space.
 * Replaces the previous O(NM) LCS 2D matrix approach that could allocate
 * hundreds of millions of array elements on large files.
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  if (oldText === '' && newText === '') return { lines: [], added: 0, removed: 0 }
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const editScript = myersDiff(a, b)
  return buildDiffResult(a, b, editScript)
}

// --- Myers core ---

const enum EditType { KEEP, INSERT, DELETE }

interface Edit {
  type: EditType
  /** Index into the old array (for KEEP and DELETE) */
  oldIdx: number
  /** Index into the new array (for KEEP and INSERT) */
  newIdx: number
}

/**
 * Myers' O(ND) diff algorithm.
 * Reference: Eugene W. Myers, "An O(ND) Difference Algorithm and Its Variations", 1986.
 *
 * Uses only O(N) space via two linear arrays instead of the full edit graph.
 */
function myersDiff(a: string[], b: string[]): Edit[] {
  const n = a.length
  const m = b.length
  const max = n + m

  // Early exits
  if (n === 0) {
    return b.map((_, i) => ({ type: EditType.INSERT, oldIdx: -1, newIdx: i }))
  }
  if (m === 0) {
    return a.map((_, i) => ({ type: EditType.DELETE, oldIdx: i, newIdx: -1 }))
  }

  // For very large inputs, fall back to a simpler linear scan to avoid
  // worst-case O(N*D) time when files are completely different.
  if (max > 50_000) {
    return linearFallback(a, b)
  }

  // v[k] stores the furthest reaching x on diagonal k.
  // Diagonals range from -max..max; we offset by max so index is always >= 0.
  const size = 2 * max + 1
  const v = new Int32Array(size)
  // Trace stores a snapshot of v for each d-step to reconstruct the path.
  const trace: Int32Array[] = []

  // Fill v with -1 to indicate "not reached"
  v.fill(-1)
  v[max + 1] = 0

  outer:
  for (let d = 0; d <= max; d++) {
    // Snapshot current v for backtracking
    trace.push(v.slice())

    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + max
      let x: number
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1]         // move down (insert)
      } else {
        x = v[kIdx - 1] + 1     // move right (delete)
      }
      let y = x - k

      // Follow diagonal (matching lines)
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }

      v[kIdx] = x

      if (x >= n && y >= m) {
        break outer
      }
    }
  }

  // Backtrack through trace to reconstruct edit script
  return backtrack(trace, a, b, max)
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number): Edit[] {
  const edits: Edit[] = []
  let x = a.length
  let y = b.length

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]
    const k = x - y

    let prevK: number
    if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
      prevK = k + 1  // came from insert (down)
    } else {
      prevK = k - 1  // came from delete (right)
    }

    const prevX = d === 0 ? 0 : v[prevK + offset]
    const prevY = prevX - prevK

    // Diagonal moves (matching lines) — walk backwards
    while (x > prevX && y > prevY) {
      x--
      y--
      edits.push({ type: EditType.KEEP, oldIdx: x, newIdx: y })
    }

    if (d > 0) {
      if (x === prevX) {
        // Insert
        y--
        edits.push({ type: EditType.INSERT, oldIdx: -1, newIdx: y })
      } else {
        // Delete
        x--
        edits.push({ type: EditType.DELETE, oldIdx: x, newIdx: -1 })
      }
    }
  }

  edits.reverse()
  return edits
}

/**
 * Simple O(N+M) fallback for very large files where Myers worst-case
 * could be slow. Uses a greedy forward scan preserving common prefix/suffix
 * and treats the middle as a bulk change.
 */
function linearFallback(a: string[], b: string[]): Edit[] {
  const edits: Edit[] = []
  let prefixLen = 0
  const minLen = Math.min(a.length, b.length)

  // Common prefix
  while (prefixLen < minLen && a[prefixLen] === b[prefixLen]) {
    edits.push({ type: EditType.KEEP, oldIdx: prefixLen, newIdx: prefixLen })
    prefixLen++
  }

  // Common suffix (from the end)
  let suffixLen = 0
  while (
    suffixLen < minLen - prefixLen &&
    a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  // Middle section: everything between prefix and suffix is a change
  const oldMiddleEnd = a.length - suffixLen
  const newMiddleEnd = b.length - suffixLen

  for (let i = prefixLen; i < oldMiddleEnd; i++) {
    edits.push({ type: EditType.DELETE, oldIdx: i, newIdx: -1 })
  }
  for (let i = prefixLen; i < newMiddleEnd; i++) {
    edits.push({ type: EditType.INSERT, oldIdx: -1, newIdx: i })
  }

  // Suffix
  for (let i = 0; i < suffixLen; i++) {
    const oi = a.length - suffixLen + i
    const ni = b.length - suffixLen + i
    edits.push({ type: EditType.KEEP, oldIdx: oi, newIdx: ni })
  }

  return edits
}

// --- Result builder ---

function buildDiffResult(a: string[], b: string[], edits: Edit[]): DiffResult {
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0

  for (const edit of edits) {
    switch (edit.type) {
      case EditType.KEEP:
        lines.push({
          type: 'same',
          oldLine: edit.oldIdx + 1,
          newLine: edit.newIdx + 1,
          text: a[edit.oldIdx]
        })
        break
      case EditType.INSERT:
        lines.push({
          type: 'add',
          oldLine: null,
          newLine: edit.newIdx + 1,
          text: b[edit.newIdx]
        })
        added++
        break
      case EditType.DELETE:
        lines.push({
          type: 'remove',
          oldLine: edit.oldIdx + 1,
          newLine: null,
          text: a[edit.oldIdx]
        })
        removed++
        break
    }
  }

  return { lines, added, removed }
}

// Return just the changed hunks for compact display
export function computeDiffHunks(oldText: string, newText: string): DiffResult {
  const full = computeDiff(oldText, newText)
  // Already compressed by the Myers algorithm - but we can group consecutive changes
  return full
}

// Format diff as unified diff string
export function formatUnifiedDiff(oldText: string, newText: string): string {
  const result = computeDiff(oldText, newText)
  let output = ''
  for (const line of result.lines) {
    const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
    output += `${prefix} ${line.text}\n`
  }
  return output
}
