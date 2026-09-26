/**
 * Harness modes: Pawn-native tuning of token spend (like a tablet's
 * battery-saver / performance modes). Lives entirely in Pawn's own loop and
 * router knobs; it never touches user-installed skills, MCP servers, or hooks,
 * and it never bypasses permissions, Plan mode, or spend budgets.
 *
 * default: today's behaviour, byte-for-byte (every knob defers to settings).
 * eco:     token saver — cheaper tiers, low reasoning, tighter budgets.
 * maxing:  token maxing — frontier tiers, high reasoning, wide fan-out.
 */
import type { ModelTier } from '../types/provider'
import type { DoneGate } from './agentMode'

export type HarnessMode = 'default' | 'eco' | 'maxing'
export type ReasoningEffortSetting = 'auto' | 'low' | 'medium' | 'high'
export type SubagentCostModeSetting = 'frugal' | 'balanced' | 'quality'
type Complexity = 'simple' | 'medium' | 'complex'

export const HARNESS_MODES: HarnessMode[] = ['default', 'eco', 'maxing']

export function parseHarnessMode(raw: unknown): HarnessMode {
  return raw === 'eco' || raw === 'maxing' ? raw : 'default'
}

export interface HarnessProfile {
  mode: HarnessMode
  /** Main-loop LLM round ceiling per user message. */
  maxToolRounds: number
  /** Compact once the transcript passes this share of the context window. */
  compactAtRatio: number
  /** Multiplier on per-tool transcript caps. */
  toolResultScale: number
  /** Tasks accepted per parallel_agents call. */
  maxParallelTasks: number
  /** Concurrent subagents; null = user setting. */
  parallelPool: number | null
  /** Auto-routing tier per complexity. */
  tierFor: Record<Complexity, ModelTier>
  /** Ceiling for auto routing unless escalation/sticky already went higher. */
  tierCeiling: ModelTier | null
  /** Rank same-tier candidates priciest first (strength proxy). */
  preferStrongest: boolean
  /** Always step down at a user-turn boundary when a cheaper tier is wanted. */
  eagerDowngrade: boolean
}

const PROFILES: Record<HarnessMode, HarnessProfile> = {
  default: {
    mode: 'default',
    maxToolRounds: 50,
    compactAtRatio: 0.6,
    toolResultScale: 1,
    maxParallelTasks: 6,
    parallelPool: null,
    tierFor: { simple: 'low', medium: 'mid', complex: 'high' },
    tierCeiling: null,
    preferStrongest: false,
    eagerDowngrade: false
  },
  eco: {
    mode: 'eco',
    maxToolRounds: 25,
    compactAtRatio: 0.45,
    toolResultScale: 0.5,
    maxParallelTasks: 3,
    parallelPool: 2,
    tierFor: { simple: 'low', medium: 'low', complex: 'mid' },
    tierCeiling: 'mid',
    preferStrongest: false,
    eagerDowngrade: true
  },
  maxing: {
    mode: 'maxing',
    maxToolRounds: 80,
    // Kept below 0.75 so the router's context-fit check never evicts the
    // current model right before compaction kicks in.
    compactAtRatio: 0.7,
    toolResultScale: 1.5,
    maxParallelTasks: 12,
    parallelPool: 8,
    tierFor: { simple: 'low', medium: 'high', complex: 'high' },
    tierCeiling: null,
    preferStrongest: true,
    eagerDowngrade: false
  }
}

export function harnessProfile(mode: HarnessMode | null | undefined): HarnessProfile {
  return PROFILES[parseHarnessMode(mode)]
}

/** Share of a model's context the router treats as "fits" for this mode. */
export function contextFitRatio(mode: HarnessMode | null | undefined): number {
  // Maxing compacts later, so the fit check must leave room past 0.7 or the
  // router would evict the current model right before compaction kicks in.
  return parseHarnessMode(mode) === 'maxing' ? harnessProfile(mode).compactAtRatio + 0.02 : 0.6
}

/**
 * Modes only move defaults: an explicit user choice (anything but 'auto')
 * always wins over the mode.
 */
export function effectiveReasoningEffort(
  user: ReasoningEffortSetting,
  mode: HarnessMode | null | undefined
): ReasoningEffortSetting {
  if (user !== 'auto') return user
  const m = parseHarnessMode(mode)
  if (m === 'eco') return 'low'
  if (m === 'maxing') return 'high'
  return user
}

/**
 * Claude extended-thinking budget from the *user* setting. On 'auto', Claude
 * runs without thinking, so eco must keep it off (a 'low' budget would add
 * tokens) while maxing turns on a deep budget.
 */
export function claudeThinkingBudget(
  user: ReasoningEffortSetting,
  mode: HarnessMode | null | undefined
): number | undefined {
  const maxing = parseHarnessMode(mode) === 'maxing'
  if (user === 'auto') return maxing ? 16_384 : undefined
  if (user === 'high' && maxing) return 16_384
  return ({ low: 2048, medium: 4096, high: 8192 } as const)[user]
}

/**
 * DeepSeek effort from the user setting. Its 'auto' is already complexity-aware
 * (thinking off on simple turns), so eco keeps it; maxing asks for 'max'.
 */
export function deepSeekEffort(
  user: ReasoningEffortSetting,
  mode: HarnessMode | null | undefined
): ReasoningEffortSetting | 'max' {
  if (user !== 'auto') return user
  return parseHarnessMode(mode) === 'maxing' ? 'max' : 'auto'
}

/**
 * 'balanced' is the untouched default; frugal/quality picked by the user win.
 * Eco goes frugal. Maxing deliberately stays balanced: its role pins (explore →
 * low, plan/reviewer → mid) keep grunt work on cheap models while workers and
 * the main agent route through the maxing tier map.
 */
export function effectiveCostMode(
  user: SubagentCostModeSetting,
  mode: HarnessMode | null | undefined
): SubagentCostModeSetting {
  if (user !== 'balanced') return user
  return parseHarnessMode(mode) === 'eco' ? 'frugal' : user
}

export function effectivePoolLimit(user: number, mode: HarnessMode | null | undefined): number {
  return harnessProfile(mode).parallelPool ?? (user || 4)
}

/** An explicit 'off' is respected everywhere; modes only shift typecheck ↔ test. */
export function effectiveDoneGate(user: DoneGate, mode: HarnessMode | null | undefined): DoneGate {
  if (user === 'off') return 'off'
  const m = parseHarnessMode(mode)
  if (m === 'eco') return 'typecheck'
  if (m === 'maxing') return 'test'
  return user
}

export function effectiveAutoMemoryConsolidate(
  user: boolean,
  mode: HarnessMode | null | undefined
): boolean {
  return parseHarnessMode(mode) === 'eco' ? false : user
}

/** Preamble block for non-default modes; default adds nothing (cache-stable). */
export function harnessPreamble(mode: HarnessMode | null | undefined): string {
  const p = harnessProfile(mode)
  if (p.mode === 'eco') {
    return (
      '--- Harness mode: ECO (token saver) ---\n' +
      'Spend as few tokens as the task allows. Keep replies short and skip restating plans or file contents. ' +
      'Batch independent reads into one round, grep or read line ranges before whole files, and avoid broad exploration. ' +
      `Prefer doing the work yourself; use subagents only when the task clearly splits (max ${p.maxParallelTasks} tasks, ${p.parallelPool} concurrent).`
    )
  }
  if (p.mode === 'maxing') {
    return (
      '--- Harness mode: MAXING (token maxing) ---\n' +
      'Favour quality over token cost. Explore broadly before editing: read surrounding code, callers, and tests. ' +
      `In Build mode, fan out independent work with parallel_agents (up to ${p.maxParallelTasks} tasks, ${p.parallelPool} concurrent) ` +
      'and run a code-reviewer subagent on non-trivial changes. ' +
      'Verify your own work: run typecheck and tests after edits and fix failures before finishing. ' +
      'Permissions, Plan mode, and spend budgets still apply.'
    )
  }
  return ''
}
