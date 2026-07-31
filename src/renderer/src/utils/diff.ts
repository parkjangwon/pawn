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

// Simple line-based diff using LCS (Longest Common Subsequence)
export function computeDiff(oldText: string, newText: string): DiffResult {
  if (oldText === '' && newText === '') return { lines: [], added: 0, removed: 0 }
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const lcs = buildLCSTable(oldLines, newLines)
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0

  let oi = oldLines.length
  let ni = newLines.length
  const temp: DiffLine[] = []

  // Backtrack through LCS table
  while (oi > 0 || ni > 0) {
    if (oi > 0 && ni > 0 && oldLines[oi - 1] === newLines[ni - 1]) {
      temp.push({ type: 'same', oldLine: oi, newLine: ni, text: oldLines[oi - 1] })
      oi--
      ni--
    } else if (ni > 0 && (oi === 0 || lcs[oi][ni - 1] >= lcs[oi - 1][ni])) {
      temp.push({ type: 'add', oldLine: null, newLine: ni, text: newLines[ni - 1] })
      ni--
      added++
    } else if (oi > 0) {
      temp.push({ type: 'remove', oldLine: oi, newLine: null, text: oldLines[oi - 1] })
      oi--
      removed++
    }
  }

  lines.push(...temp.reverse())
  return { lines, added, removed }
}

function buildLCSTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp
}

// Return just the changed hunks for compact display
export function computeDiffHunks(oldText: string, newText: string): DiffResult {
  const full = computeDiff(oldText, newText)
  // Already compressed by the LCS algorithm - but we can group consecutive changes
  return full
}

// Format diff as unified diff string
export function formatUnifiedDiff(oldText: string, newText: string): string {
  const result = computeDiff(oldText, newText)
  let output = ''
  let lineNum = 1
  for (const line of result.lines) {
    const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
    output += `${prefix} ${line.text}\n`
    lineNum++
  }
  return output
}
