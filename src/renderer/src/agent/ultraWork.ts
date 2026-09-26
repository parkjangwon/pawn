/**
 * Ultra Work — goal-driven, token-maxing autonomous mode.
 *
 * `$ulw <goal>` / `/ultra-work <goal>` / `ulw: <goal>` starts a run. While a
 * run is active the session is forced into Build + MAXING, the agent gets the
 * Ultra Work contract (explore → research → implement end to end → verify →
 * keep iterating), and after every turn a cheap evaluator model checks the
 * goal against what actually happened. Not done → the next turn starts
 * automatically with the evaluator's reason as guidance. It ends when the
 * goal is achieved, the agent reports a hard blocker, the budget runs out,
 * or the user stops it.
 *
 * Inspired by oh-my-opencode's `ultrawork`/`ulw` keyword mode and the
 * `/goal` completion-condition loops in Claude Code and Codex.
 */

export const ULW_DEFAULT_MAX_ITERATIONS = 12
export const ULW_MAX_ITERATIONS_CAP = 40

/** Agent's own completion markers (fallback when no evaluator model). */
export const ULW_DONE_MARKER = '<ultrawork>DONE</ultrawork>'
export const ULW_BLOCKED_RE = /<ultrawork>BLOCKED:\s*([\s\S]*?)<\/ultrawork>/i

export type UltraWorkStatus = 'active' | 'achieved' | 'unmet' | 'budget_limited' | 'stopped'

export interface UltraWorkRun {
  sessionId: string
  goal: string
  status: UltraWorkStatus
  iteration: number
  maxIterations: number
  startedAt: number
  endedAt?: number
  /** Latest evaluator (or self-report) verdict reason. */
  lastReason?: string
  /** Cost / tokens at start, to report the run's own spend. */
  baseCost: number
  baseTokens: number
}

export interface ParsedUltraWork {
  goal: string
  maxIterations: number
}

/**
 * Trigger grammar (start of message only, so casual mentions don't fire):
 *   $ulw <goal>   $ultrawork <goal>   /ulw <goal>   /ultra-work <goal>
 *   ulw: <goal>   ultrawork: <goal>   울트라워크: <goal>
 * Optional budget flag anywhere: `--max 20` / `--max=20`.
 */
const TRIGGER_RE =
  /^\s*(?:[$/](?:ulw|ultra-?work)\b|(?:ulw|ultra-?work|울트라\s?워크)\s*:)\s*/i

export function parseUltraWork(input: string): ParsedUltraWork | null {
  const m = TRIGGER_RE.exec(input)
  if (!m) return null
  let rest = input.slice(m[0].length)
  let maxIterations = ULW_DEFAULT_MAX_ITERATIONS
  const flag = /(?:^|\s)--max(?:=|\s+)(\d{1,3})\b/.exec(rest)
  if (flag) {
    maxIterations = Math.min(ULW_MAX_ITERATIONS_CAP, Math.max(1, Number(flag[1])))
    rest = (rest.slice(0, flag.index) + rest.slice(flag.index + flag[0].length)).trim()
  }
  const goal = rest.trim()
  return goal ? { goal, maxIterations } : { goal: '', maxIterations }
}

/** Where the trigger keyword ends in the draft (for composer highlighting). */
export function ultraWorkTriggerLength(input: string): number {
  const m = TRIGGER_RE.exec(input)
  return m ? m[0].trimEnd().length : 0
}

export function ultraWorkPreamble(run: Pick<UltraWorkRun, 'goal' | 'iteration' | 'maxIterations'>): string {
  return [
    '--- ULTRA WORK MODE (goal-driven, token maxing) ---',
    `GOAL: ${run.goal}`,
    `Iteration ${run.iteration} of at most ${run.maxIterations}. You keep getting turns until the goal is verifiably done.`,
    'Contract:',
    '1. Explore before acting: read the relevant code, callers, tests, and conventions; resolve ambiguity yourself (state assumptions). Only use ask_user for decisions that are truly the user\'s.',
    '2. Plan with update_plan and keep it current.',
    '3. Implement end to end. No stubs, TODOs, "left as an exercise", or quietly reduced scope. Fan out independent work with parallel_agents; use a code-reviewer subagent on non-trivial changes.',
    '4. Verify with evidence: run_checks / tests / lsp_diagnostics, and show the result. Fix failures in the same turn.',
    '5. Iterate until done. When — and only when — the goal is fully met and verified, end your final message with ' +
      `${ULW_DONE_MARKER}. If you hit a hard blocker you cannot work around (missing credentials, external outage), end with ` +
      '<ultrawork>BLOCKED: reason</ultrawork>. Never claim done without verification.'
  ].join('\n')
}

export function continuationPrompt(run: Pick<UltraWorkRun, 'goal' | 'iteration' | 'maxIterations'>, reason?: string): string {
  return [
    `[Ultra Work · iteration ${run.iteration}/${run.maxIterations}] The goal is not complete yet.`,
    reason ? `Evaluator: ${reason}` : '',
    `Goal: ${run.goal}`,
    'Continue from where you left off: address the gap above, verify, and keep going. Do not repeat finished work or re-summarize.'
  ]
    .filter(Boolean)
    .join('\n')
}

export interface GoalVerdict {
  met: boolean
  /** The agent reported a hard blocker — stop instead of looping. */
  blocked?: boolean
  reason: string
}

/** Self-reported markers in the agent's final message. */
export function selfReportedVerdict(finalText: string): GoalVerdict | null {
  const blocked = ULW_BLOCKED_RE.exec(finalText)
  if (blocked) return { met: false, blocked: true, reason: blocked[1].trim().slice(0, 400) || 'blocked' }
  if (finalText.includes(ULW_DONE_MARKER)) return { met: true, reason: 'The agent reported the goal as done.' }
  return null
}

export const EVALUATOR_SYSTEM_PROMPT = `You judge whether an autonomous coding agent has completed a goal. You only see the transcript excerpt — no files — so judge from the evidence in it.

Answer with a single JSON object and nothing else:
{"met": true|false, "blocked": true|false, "reason": "<one or two sentences>"}

- met=true only if the transcript shows the goal is fully achieved AND verified (e.g. tests/typecheck/build output passing, requested behavior demonstrated). Claims without evidence are not enough.
- blocked=true only if the agent hit a hard external blocker it cannot resolve (missing credentials/access, outage). Normal failures are not blockers.
- If not met, "reason" must say concretely what is still missing or failing, as guidance for the next iteration.`

/** Lenient JSON verdict parser (models wrap JSON in prose / code fences). */
export function parseVerdict(text: string): GoalVerdict | null {
  const m = /\{[\s\S]*\}/.exec(text || '')
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { met?: unknown; blocked?: unknown; reason?: unknown }
    if (typeof j.met !== 'boolean') return null
    return {
      met: j.met,
      ...(j.blocked === true && !j.met ? { blocked: true } : {}),
      reason: typeof j.reason === 'string' && j.reason.trim() ? j.reason.trim().slice(0, 600) : j.met ? 'Goal met.' : 'Not done yet.'
    }
  } catch {
    return null
  }
}

export function formatUltraDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}
