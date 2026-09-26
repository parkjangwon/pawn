/**
 * Small tiered fuzzy matcher (prefix < substring < subsequence) with match
 * ranges for highlighting. Lower score = better match; null = no match.
 *
 * CJK (Han/Hangul/Kana) queries only match by prefix/substring: subsequence
 * matching over ideographs or syllable blocks is far too permissive.
 */

export interface MatchRange {
  start: number
  end: number
}

/** Han (CJK Unified + Ext A + Compatibility), Hangul syllables/jamo, Kana. */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/

function fold(s: string): string {
  const lower = s.toLowerCase()
  // Case folding must not change length, or match indexes drift.
  return lower.length === s.length ? lower : s
}

export function scoreFuzzy(text: string, query: string): number | null {
  const t = fold(text.trim())
  const q = fold(query.trim())
  if (!q) return 0
  if (!t) return null
  if (t.startsWith(q)) return t.length - q.length
  const idx = t.indexOf(q)
  if (idx !== -1) return 100 + idx
  if (CJK_RE.test(q)) return null
  let score = 200
  let from = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, from)
    if (found === -1) return null
    score += found - from
    from = found + 1
  }
  return score + (t.length - q.length)
}

export interface FuzzyField {
  text: string | undefined
  /** Added to the field's score so e.g. labels outrank descriptions. */
  weight: number
}

/**
 * Multi-term, multi-field score: every whitespace-separated term must match
 * at least one field. Returns the summed best score per term, or null.
 */
export function scoreFields(fields: FuzzyField[], query: string): number | null {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return 0
  let total = 0
  for (const term of terms) {
    let best: number | null = null
    for (const f of fields) {
      if (!f.text) continue
      const s = scoreFuzzy(f.text, term)
      if (s === null) continue
      const weighted = s + f.weight
      if (best === null || weighted < best) best = weighted
    }
    if (best === null) return null
    total += best
  }
  return total
}

export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: MatchRange[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (!last || r.start > last.end) {
      merged.push({ ...r })
      continue
    }
    last.end = Math.max(last.end, r.end)
  }
  return merged
}

/**
 * Character ranges in `text` to highlight for `query`. Each term highlights
 * its substring occurrence; terms that only match as a subsequence highlight
 * the individual characters.
 */
export function fuzzyMatchRanges(text: string, query: string): MatchRange[] {
  const t = fold(text)
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean).map(fold))]
  const ranges: MatchRange[] = []
  for (const term of terms) {
    const idx = t.indexOf(term)
    if (idx !== -1) {
      ranges.push({ start: idx, end: idx + term.length })
      continue
    }
    if (CJK_RE.test(term)) continue
    const chars: MatchRange[] = []
    let from = 0
    let ok = true
    for (const ch of term) {
      const found = t.indexOf(ch, from)
      if (found === -1) {
        ok = false
        break
      }
      chars.push({ start: found, end: found + ch.length })
      from = found + ch.length
    }
    if (ok) ranges.push(...chars)
  }
  return mergeRanges(ranges)
}
