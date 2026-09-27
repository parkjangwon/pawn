/**
 * Gambits — `$` keyword modes typed at the start of a message.
 *
 * In chess a gambit is an opening move that commits to a whole plan; here a
 * `$keyword` opening a message switches how the entire turn runs (e.g. `$ulw`
 * starts Ultra Work). Typing `$` at the start of the composer lists them, the
 * same way `/` lists commands and skills.
 *
 * Gambits only count at the very start of a message, so money amounts or
 * shell variables later in a sentence ("costs $5", "echo $HOME") never
 * trigger anything.
 */

export interface Gambit {
  /** Canonical keyword, typed as `$<keyword>`. */
  keyword: string
  /** Other spellings that also work (shown as a hint). */
  aliases: string[]
  /** i18n keys for the menu row. */
  labelKey: string
  descKey: string
  /** Placeholder shown after the keyword (i18n key), e.g. "<goal>". */
  argKey?: string
}

export const GAMBITS: readonly Gambit[] = [
  {
    keyword: 'ulw',
    aliases: ['ultrawork'],
    labelKey: 'ultraWork.title',
    descKey: 'gambits.ulwDesc',
    argKey: 'gambits.goalArg'
  }
]

/**
 * `$` trigger at the start of the draft: returns where the keyword starts
 * and what has been typed after `$` so far, or null when the caret is not
 * inside an opening `$word`.
 */
export function gambitTrigger(beforeCaret: string): { start: number; query: string } | null {
  const m = /^(\s*)\$([^\s$]*)$/.exec(beforeCaret)
  if (!m) return null
  return { start: m[1].length, query: m[2] }
}

/** Gambits matching a partial keyword (prefix on keyword or alias). */
export function matchGambits(query: string): Gambit[] {
  const q = query.toLowerCase()
  if (!q) return [...GAMBITS]
  return GAMBITS.filter((g) => [g.keyword, ...g.aliases].some((k) => k.startsWith(q)))
}
