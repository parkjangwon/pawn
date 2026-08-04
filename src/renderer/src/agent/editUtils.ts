/**
 * Edit helpers: unique replace + whitespace-tolerant fallback.
 * Pure functions for unit tests.
 */

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

export type ApplyEditResult =
  | { ok: true; updated: string; replacements: number; mode: 'exact' | 'replace_all' | 'flex_ws' }
  | { ok: false; error: string; hint?: string }

/**
 * Collapse runs of spaces/tabs (not newlines) for flexible matching.
 * Preserves line structure so multi-line blocks still align.
 */
function flexKey(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/[ \t]+$/g, ''))
    .join('\n')
}

/**
 * Apply an edit. Prefer exact match; if unique flex-whitespace match exists, use it.
 */
export function applyEdit(
  fileContent: string,
  oldString: string,
  newString: string,
  replaceAll = false
): ApplyEditResult {
  if (!oldString) {
    return { ok: false, error: 'old_string must not be empty' }
  }
  if (oldString === newString) {
    return { ok: false, error: 'old_string and new_string are identical' }
  }

  const exactCount = countOccurrences(fileContent, oldString)
  if (exactCount === 1) {
    return {
      ok: true,
      updated: fileContent.replace(oldString, newString),
      replacements: 1,
      mode: 'exact'
    }
  }
  if (exactCount > 1) {
    if (replaceAll) {
      return {
        ok: true,
        updated: fileContent.split(oldString).join(newString),
        replacements: exactCount,
        mode: 'replace_all'
      }
    }
    return {
      ok: false,
      error: `old_string appears ${exactCount} times in file. Provide more surrounding context to make it unique, or set replace_all: true.`
    }
  }

  // Exact miss: try whitespace-flexible unique match (indent/space drift).
  const flexOld = flexKey(oldString)
  if (!flexOld.trim()) {
    return {
      ok: false,
      error:
        'old_string not found in file. Re-read the file and use the exact current text (including whitespace).'
    }
  }

  const fileLines = fileContent.split('\n')
  const oldLines = oldString.split('\n')
  const flexOldLines = flexOld.split('\n')
  const matches: number[] = []

  for (let i = 0; i <= fileLines.length - flexOldLines.length; i++) {
    let ok = true
    for (let j = 0; j < flexOldLines.length; j++) {
      if (flexKey(fileLines[i + j]) !== flexOldLines[j]) {
        ok = false
        break
      }
    }
    if (ok) matches.push(i)
    if (matches.length > 2) break // early exit once clearly ambiguous
  }

  if (matches.length === 0) {
    // Hint: find lines that share the first non-empty line of old_string
    const needle = oldLines.map((l) => l.trim()).find((l) => l.length > 0) || ''
    let hint: string | undefined
    if (needle.length >= 4) {
      const hits: string[] = []
      for (let i = 0; i < fileLines.length && hits.length < 5; i++) {
        if (fileLines[i].includes(needle.slice(0, Math.min(40, needle.length)))) {
          hits.push(`  L${i + 1}: ${fileLines[i].trim().slice(0, 120)}`)
        }
      }
      if (hits.length > 0) {
        hint = `Nearby lines that look similar:\n${hits.join('\n')}`
      }
    }
    return {
      ok: false,
      error:
        'old_string not found in file. Re-read the file and use the exact current text (including whitespace).',
      hint
    }
  }

  if (matches.length > 1 && !replaceAll) {
    return {
      ok: false,
      error: `old_string matches ${matches.length} places with flexible whitespace. Provide more context or set replace_all: true.`
    }
  }

  // Apply flex matches from bottom to top so indices stay valid
  const targets = replaceAll ? matches : [matches[0]]
  const newLines = newString.split('\n')
  let updatedLines = [...fileLines]
  for (const start of [...targets].sort((a, b) => b - a)) {
    updatedLines.splice(start, oldLines.length, ...newLines)
  }

  return {
    ok: true,
    updated: updatedLines.join('\n'),
    replacements: targets.length,
    mode: 'flex_ws'
  }
}
