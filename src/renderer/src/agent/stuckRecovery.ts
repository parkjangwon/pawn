/**
 * Stuck recovery: notice when the agent is spinning and climb a ladder of
 * increasingly strong interventions instead of hard-stopping the turn.
 *
 * Signals (per tool round):
 *   repeat_calls  the same tool-call set several rounds in a row
 *   repeat_error  the same tool failing with the same error again and again
 *   error_streak  every recent round had failing tools
 *   edit_thrash   one file edited over and over while checks keep failing
 *   read_loop     the same file / search re-read many times
 *
 * Ladder (one step per persisting signal, at least COOLDOWN rounds apart):
 *   1 reflect        nudge: stop, state what is known, pick a different approach
 *   2 escalate       + route the next rounds to a stronger model tier
 *   3 second_opinion + ask a different model to diagnose (caller performs it)
 *   4 rollback       + suggest checkpoint_restore / reverting the last edits
 *   5 ask_user       stop and hand back to the user with a summary
 */

import type { ToolCall } from './toolDefinitionsTypes'
import { callPaths, isFileMutation } from './nativeTools'

export type StuckSignalKind = 'repeat_calls' | 'repeat_error' | 'error_streak' | 'edit_thrash' | 'read_loop'
export type RecoveryAction = 'reflect' | 'escalate' | 'second_opinion' | 'rollback' | 'ask_user'

export interface RoundObservation {
  calls: Array<Pick<ToolCall, 'name' | 'arguments' | 'toolset'>>
  results: Array<{ name: string; isError?: boolean; content: string }>
}

export interface StuckSignal {
  kind: StuckSignalKind
  detail: string
}

export interface RecoveryStep {
  level: number
  action: RecoveryAction
  signal: StuckSignal
  /** Text appended to the round's last tool result for the model. */
  nudge: string
}

const LADDER: RecoveryAction[] = ['reflect', 'escalate', 'second_opinion', 'rollback', 'ask_user']
const COOLDOWN_ROUNDS = 2

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${k}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

/** Error text with volatile parts (numbers, paths' line:col, ids, times) removed. */
export function normalizeError(text: string): string {
  return text
    .slice(0, 600)
    .replace(/0x[0-9a-f]+/gi, 'X')
    .replace(/\d+(\.\d+)?(ms|s)\b/g, 'T')
    .replace(/:\d+(:\d+)?/g, ':N')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

export class StuckDetector {
  private round = 0
  private level = 0
  private lastStepRound = -100
  private lastSignature: string | null = null
  private sameSignatureRounds = 0
  private errorHistory: Array<{ round: number; key: string }> = []
  private errorRoundsInRow = 0
  private edits = new Map<string, number>()
  private reads = new Map<string, number>()
  private failingChecks = 0
  private calmRounds = 0

  constructor(private readonly opts: { repeatRounds?: number; errorRepeats?: number; errorStreak?: number; editThrash?: number; readLoop?: number } = {}) {}

  get currentLevel(): number {
    return this.level
  }

  /** Record one tool round; returns the next recovery step, or null. */
  observe(obs: RoundObservation): RecoveryStep | null {
    this.round++
    const signal = this.detect(obs)
    if (!signal) {
      this.calmRounds++
      return null
    }
    this.calmRounds = 0
    if (this.round - this.lastStepRound < COOLDOWN_ROUNDS && this.level > 0) return null
    this.level = Math.min(LADDER.length, this.level + 1)
    this.lastStepRound = this.round
    const action = LADDER[this.level - 1]
    return { level: this.level, action, signal, nudge: nudgeFor(this.level, action, signal) }
  }

  private detect(obs: RoundObservation): StuckSignal | null {
    const repeatRounds = this.opts.repeatRounds ?? 3
    const errorRepeats = this.opts.errorRepeats ?? 3
    const errorStreak = this.opts.errorStreak ?? 4
    const editThrash = this.opts.editThrash ?? 6
    const readLoop = this.opts.readLoop ?? 4

    // repeat_calls
    const sig = obs.calls.map((c) => `${c.toolset || ''}${c.name}:${stable(c.arguments)}`).sort().join('|')
    this.sameSignatureRounds = sig && sig === this.lastSignature ? this.sameSignatureRounds + 1 : 1
    this.lastSignature = sig
    const signals: StuckSignal[] = []
    if (this.sameSignatureRounds >= repeatRounds) {
      signals.push({ kind: 'repeat_calls', detail: `the same ${obs.calls.map((c) => c.name).join(', ')} call${obs.calls.length > 1 ? 's' : ''} ${this.sameSignatureRounds} rounds in a row` })
    }

    // errors
    const errors = obs.results.filter((r) => r.isError)
    this.errorRoundsInRow = errors.length > 0 ? this.errorRoundsInRow + 1 : 0
    for (const e of errors) this.errorHistory.push({ round: this.round, key: `${e.name}|${normalizeError(e.content)}` })
    this.errorHistory = this.errorHistory.filter((e) => this.round - e.round < 8)
    const counts = new Map<string, number>()
    for (const e of this.errorHistory) counts.set(e.key, (counts.get(e.key) || 0) + 1)
    for (const [key, n] of Array.from(counts.entries())) {
      if (n >= errorRepeats) {
        const [name, msg] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]
        signals.push({ kind: 'repeat_error', detail: `${name} failed ${n} times with the same error: ${msg.slice(0, 160)}` })
        break
      }
    }
    if (this.errorRoundsInRow >= errorStreak) {
      signals.push({ kind: 'error_streak', detail: `${this.errorRoundsInRow} rounds in a row had failing tools` })
    }

    // edit thrash + failing checks
    const checkFailed = obs.results.some(
      (r) => (r.name === 'run_checks' || r.name === 'shell_exec' || r.name === 'bash') && r.isError
    )
    this.failingChecks = checkFailed ? this.failingChecks + 1 : obs.results.some((r) => r.name === 'run_checks' && !r.isError) ? 0 : this.failingChecks
    for (const c of obs.calls) {
      if (isFileMutation(c)) {
        for (const p of callPaths(c)) this.edits.set(p, (this.edits.get(p) || 0) + 1)
      } else if (c.name === 'read_file' || (c.name === 'str_replace_based_edit_tool' && c.arguments?.command === 'view') || c.name === 'grep_search') {
        const key = `${c.name}:${stable(c.arguments)}`
        this.reads.set(key, (this.reads.get(key) || 0) + 1)
      }
    }
    if (this.failingChecks >= 2) {
      for (const [path, n] of Array.from(this.edits.entries())) {
        if (n >= editThrash) {
          signals.push({ kind: 'edit_thrash', detail: `${path} edited ${n} times while checks keep failing` })
          break
        }
      }
    }
    for (const [key, n] of Array.from(this.reads.entries())) {
      if (n >= readLoop) {
        signals.push({ kind: 'read_loop', detail: `${key.slice(0, key.indexOf(':'))} with the same arguments ${n} times` })
        this.reads.set(key, 0)
        break
      }
    }
    // Most specific first.
    const order: StuckSignalKind[] = ['repeat_error', 'edit_thrash', 'repeat_calls', 'error_streak', 'read_loop']
    signals.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    return signals[0] ?? null
  }
}

export function nudgeFor(level: number, action: RecoveryAction, signal: StuckSignal): string {
  const head = `<stuck_recovery level="${level}" signal="${signal.kind}">\nYou seem to be stuck: ${signal.detail}.`
  const reflect =
    'Stop repeating the same step. In your next message, briefly: (1) what you now know for certain, (2) two or three different hypotheses for why it is not working, (3) the one different approach you will try next and how you will verify it. Read the actual error text carefully; check assumptions (paths, versions, the file\'s current content) instead of retrying.'
  let body: string
  switch (action) {
    case 'reflect':
      body = reflect
      break
    case 'escalate':
      body = `${reflect}\nA stronger model now handles the next steps — use it: widen the search (read callers, tests, configs, docs) before editing again.`
      break
    case 'second_opinion':
      body = 'A second opinion from a different model is attached below. Weigh it critically against the evidence, then change course.'
      break
    case 'rollback':
      body =
        'Your recent edits have not converged. Consider undoing them (checkpoint_restore to a mark you set, or re-apply the original text) and start again from a clean, working state with a smaller change. Run the relevant test after each step.'
      break
    case 'ask_user':
    default:
      body = 'Stop here and explain to the user what you tried, what failed (exact errors), and what decision or information you need from them.'
  }
  return `${head}\n${body}\n</stuck_recovery>`
}

/** Compact digest for a second-opinion request. */
export function stuckDigest(
  goal: string,
  history: Array<{ call: string; result: string; isError?: boolean }>,
  signal: StuckSignal
): string {
  const lines = history.slice(-14).map((h) => `- ${h.call}\n  → ${h.isError ? 'ERROR ' : ''}${h.result.replace(/\s+/g, ' ').slice(0, 400)}`)
  return `Goal:\n${goal.slice(0, 2000)}\n\nWhy it looks stuck: ${signal.detail}\n\nRecent tool calls and results (oldest first):\n${lines.join('\n')}`
}

export const SECOND_OPINION_PROMPT = `You are a senior engineer giving a second opinion to a coding agent that is stuck. You see its goal and its most recent tool calls with their results.

Reply in at most ~200 words:
1. The most likely root cause (cite the evidence).
2. What the agent is doing wrong (e.g. retrying, wrong file, wrong assumption).
3. The concrete next 1-3 steps (commands, files, checks).
No preamble. If the evidence is insufficient, say what to inspect first.`
