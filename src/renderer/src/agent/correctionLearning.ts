/**
 * Correction learning: when the user corrects the agent ("no, use pnpm",
 * "don't touch the generated files", "아니 그게 아니라…"), or reverts its
 * changes and explains, turn that into a durable lesson — a procedural
 * Memory card scoped to the project (and a repo-profile note) — so the same
 * mistake is not repeated in later sessions.
 */

export interface CorrectionSignal {
  confidence: number
  reason: 'explicit' | 'revert'
}

// Leading / standalone correction phrases in the four UI languages.
const STRONG = [
  /^(no|nope|wrong|incorrect|that'?s (not|wrong)|not (like )?that|stop|undo|revert)\b/i,
  /\b(that'?s not what i (asked|meant|wanted)|you (misunderstood|broke|ignored)|i (said|told you|asked you) (to|not)|don'?t (ever|do that|use|touch|change|add|remove)|never (use|do|touch)|instead of|rather than|should(n'?t| not) have)\b/i,
  /^(아니|아니야|아니요|틀렸|잘못)|그게 아니|그거 말고|말고\s|하지 ?마|쓰지 ?마|건드리지 ?마|바꾸지 ?마|되돌려|원래대로|왜 (그렇게|이렇게)|내가 (말한|말했|요청한)/,
  /^(違う|ちがう|いいえ)|そうじゃな|ではなく|じゃなくて|しないで|使わないで|触らないで|元に戻して/,
  /^(不对|不是|错了)|不要(用|改|动|加|删)|别(用|改|动)|而不是|应该用|撤销|改回/
]

/** Is this user message a correction of the previous agent turn? */
export function detectCorrection(userText: string, ctx: { hadAgentTurn: boolean; reverted?: boolean }): CorrectionSignal | null {
  const text = (userText || '').trim()
  if (!ctx.hadAgentTurn || text.length < 3 || text.length > 2000) return null
  const head = text.slice(0, 400)
  const strong = STRONG.some((re) => re.test(head))
  if (ctx.reverted && text.length >= 8) return { confidence: strong ? 0.85 : 0.7, reason: 'revert' }
  if (!strong) return null
  // Questions without a directive are usually clarifications, not corrections.
  const directive = /\b(use|do|don'?t|never|always|should|must|instead|change|keep|put|call|run)\b|해|하지|써|쓰지|말고|해야|するな|して|使|不要|别|应该/i.test(head)
  return { confidence: directive ? 0.8 : 0.6, reason: 'explicit' }
}

export function lessonTitle(correction: string): string {
  const one = correction.replace(/\s+/g, ' ').trim()
  return `Correction: ${one.slice(0, 70)}${one.length > 70 ? '…' : ''}`
}

/** Heuristic lesson text (used when no model is available to distill it). */
export function heuristicLesson(opts: { correction: string; previousRequest?: string; files?: string[]; reverted?: boolean }): string {
  const parts = [`The user corrected the agent: "${opts.correction.trim().slice(0, 600)}"`]
  if (opts.previousRequest) parts.push(`Context — the request being worked on: "${opts.previousRequest.trim().slice(0, 300)}"`)
  if (opts.reverted) parts.push(`The user reverted the agent's changes${opts.files?.length ? ` to ${opts.files.slice(0, 6).join(', ')}` : ''}.`)
  parts.push('Apply this preference in future work in this project.')
  return parts.join('\n')
}

export const LESSON_PROMPT = `Distill a user's correction of a coding agent into ONE durable rule for future sessions in the same project.
Output a single imperative sentence (max 30 words) that states what to do (and, if clear, what not to do). Make it specific (tools, commands, files, style). If the correction is only about this one task and has no reusable lesson, output exactly: NONE`

// --- revert tracking (TurnReviewBar undo → next message is likely a correction) ---

const recentReverts = new Map<string, { at: number; files: string[] }>()

export function noteRevert(sessionId: string, files: string[]): void {
  recentReverts.set(sessionId, { at: Date.now(), files: files.slice(0, 20) })
}

/** Consume a revert that happened in the last 30 minutes. */
export function takeRecentRevert(sessionId: string): { files: string[] } | null {
  const r = recentReverts.get(sessionId)
  if (!r) return null
  recentReverts.delete(sessionId)
  return Date.now() - r.at < 30 * 60_000 ? { files: r.files } : null
}
