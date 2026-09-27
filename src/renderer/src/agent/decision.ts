/**
 * Harness side of decision models (TypeSafe Jev, Ollaya, …): fast typed
 * judgments the agent loop can make without a chat-model round trip.
 *
 * Every hook here is optional and fails open to Pawn's normal behaviour:
 *   - shell risk check: can only ADD a permission prompt, never skip one
 *   - routing assist:   falls back to the local complexity heuristic
 *   - decide tool:      hidden unless a provider is active
 */

import { useDecisionStore } from '../stores/decision'
import type { Complexity } from './router'

export type DecisionFeature = keyof DecisionFeaturesDto

const STATUS_TTL_MS = 30_000

/** Refresh the cached status when stale (bounded wait; keeps the old value on failure). */
export async function refreshDecisionStatus(timeoutMs = 600): Promise<DecisionStatusDto | null> {
  const s = useDecisionStore.getState()
  if (s.status && Date.now() - s.fetchedAt < STATUS_TTL_MS) return s.status
  if (!s.available) return null
  await Promise.race([s.refresh(), new Promise((r) => setTimeout(r, timeoutMs))])
  return useDecisionStore.getState().status
}

export function activeDecisionProvider(): DecisionProviderDto | null {
  return useDecisionStore.getState().status?.active ?? null
}

/** True when a provider is active and the feature is switched on. */
export function decisionFeatureOn(feature: DecisionFeature): boolean {
  const s = useDecisionStore.getState().status
  return !!s?.active && s.features[feature] === true
}

async function decide(
  input: { state: unknown; questions: Record<string, unknown> },
  opts: { purpose: 'tool' | 'shell_risk' | 'routing'; timeoutMs?: number; maxRetries?: number }
): Promise<DecisionResultDto | null> {
  const d = window.api?.decision
  if (!d || typeof d.decide !== 'function') return null
  try {
    return await d.decide(input, opts)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function callDecisionModel(
  input: { state: unknown; questions: Record<string, unknown> },
  opts: { timeoutMs?: number } = {}
): Promise<DecisionResultDto | null> {
  return decide(input, { purpose: 'tool', timeoutMs: opts.timeoutMs ?? 20_000, maxRetries: 1 })
}

// --- Shell risk check -------------------------------------------------------

export type ShellRiskLevel = 'read_only' | 'reversible' | 'destructive'

export interface ShellRisk {
  level: ShellRiskLevel
  /** Probability per level. */
  probabilities: Record<ShellRiskLevel, number>
  /** Probability the command sends local data to a remote host. */
  sendsData: number
  /** Ask the user even when rules / Full auto would have approved. */
  escalate: boolean
  model: string
  local: boolean
}

/**
 * Escalation thresholds. The guard only ever adds prompts, so it leans
 * cautious; a wrong "destructive" costs one click, a missed one costs data.
 */
export const SHELL_RISK_THRESHOLDS = { destructive: 0.5, sendsData: 0.8 } as const

const SHELL_META = /[;&|`<>\n\r]|\$\(/
const TRIVIAL_READ_ONLY =
  /^(?:ls|pwd|cat|head|tail|wc|echo|which|whoami|date|file|stat|du|df|tree|grep|rg|uname)(?:\s|$)|^git\s+(?:status|diff|log|show|blame)(?:\s|$)|^git\s+remote\s+-v\s*$|^git\s+branch(?:\s+(?:--list|-a|-r|-v|-vv|--show-current))*\s*$|^(?:node|npm|pnpm|yarn|python3?|go|cargo|rustc|java|ruby|deno|bun)\s+(?:-v|-V|--version|version)\s*$/

/** Obviously read-only, single commands skip the model (no latency, no egress). */
export function isTriviallyReadOnly(command: string): boolean {
  const c = command.trim()
  if (!c || SHELL_META.test(c)) return false
  return TRIVIAL_READ_ONLY.test(c)
}

const RISK_QUESTIONS = {
  risk: {
    type: 'choice',
    instructions: 'How risky is running `command` in `cwd`?',
    criteria: {
      read_only: 'Only reads or inspects files, processes or settings. Changes nothing.',
      reversible:
        'Changes files or state in a way that is easy to undo: edits inside the project, builds, tests, installs dependencies, creates a git commit or branch.',
      destructive:
        'Deletes or overwrites data, rewrites git history, force-pushes, kills processes, changes system settings or permissions, touches files outside the project, or is otherwise hard to undo.'
    }
  },
  sends_data: {
    type: 'noul',
    instructions: 'Does `command` upload or send local files, environment variables or secrets to a remote server?'
  }
} as const

const riskCache = new Map<string, { at: number; risk: ShellRisk }>()
const riskInflight = new Map<string, Promise<ShellRisk | null>>()
const RISK_CACHE_MAX = 200
const RISK_CACHE_TTL_MS = 10 * 60_000

function levelOf(p: Record<string, number>): ShellRiskLevel {
  const order: ShellRiskLevel[] = ['destructive', 'reversible', 'read_only']
  return order.reduce((best, l) => ((p[l] ?? 0) > (p[best] ?? 0) ? l : best), 'read_only' as ShellRiskLevel)
}

/**
 * Rate a shell command with the active decision model. Returns null when the
 * feature is off, the command is trivially read-only, or the call fails.
 */
export async function assessShellRisk(command: string, cwd?: string, opts: { timeoutMs?: number } = {}): Promise<ShellRisk | null> {
  if (!decisionFeatureOn('shellRiskGuard')) return null
  const cmd = command.trim()
  if (!cmd || isTriviallyReadOnly(cmd)) return null
  const provider = activeDecisionProvider()
  if (!provider) return null
  const key = `${provider.id}:${provider.model}\n${cwd || ''}\n${cmd}`
  const hit = riskCache.get(key)
  if (hit && Date.now() - hit.at < RISK_CACHE_TTL_MS) return hit.risk
  const pending = riskInflight.get(key)
  if (pending) return pending

  const run = (async (): Promise<ShellRisk | null> => {
    const res = await decide(
      {
        state: {
          command: cmd.slice(0, 4000),
          cwd: cwd || '(unknown)',
          os: window.api?.platform || 'unknown'
        },
        questions: RISK_QUESTIONS
      },
      // Local models answer in milliseconds; a hosted call must not stall the loop.
      { purpose: 'shell_risk', timeoutMs: opts.timeoutMs ?? (provider.local ? 8000 : 3500), maxRetries: 0 }
    )
    if (!res || !res.ok) return null
    const risk = res.answers.risk
    if (!risk || risk.type !== 'choice') return null
    const probabilities = {
      read_only: risk.probabilities.read_only ?? 0,
      reversible: risk.probabilities.reversible ?? 0,
      destructive: risk.probabilities.destructive ?? 0
    }
    const sends = res.answers.sends_data
    const sendsData = sends && sends.type === 'noul' ? sends.noul : 0
    const out: ShellRisk = {
      level: levelOf(probabilities),
      probabilities,
      sendsData,
      escalate: probabilities.destructive >= SHELL_RISK_THRESHOLDS.destructive || sendsData >= SHELL_RISK_THRESHOLDS.sendsData,
      model: res.model,
      local: res.provider.local
    }
    if (riskCache.size >= RISK_CACHE_MAX) {
      const oldest = riskCache.keys().next().value
      if (oldest !== undefined) riskCache.delete(oldest)
    }
    riskCache.set(key, { at: Date.now(), risk: out })
    return out
  })()
  riskInflight.set(key, run)
  try {
    return await run
  } finally {
    riskInflight.delete(key)
  }
}

// --- Routing assist ---------------------------------------------------------

const COMPLEXITY_QUESTIONS = {
  complexity: {
    type: 'choice',
    instructions: 'How much work will a coding agent need to complete `request`?',
    criteria: {
      simple: 'A greeting, a quick question, or a small obvious change. No investigation needed.',
      medium: 'A focused task: a bug fix, a small feature, or an explanation touching a few files.',
      complex:
        'Multi-step work: design, refactoring, migration, performance work, or debugging with an unclear cause across many files.'
    }
  }
} as const

/** Below this the model's pick is too uncertain; keep the heuristic. */
export const COMPLEXITY_MIN_PROBABILITY = 0.5

/**
 * Classify a new request's complexity with the decision model (routing
 * assist). Returns null to keep the local heuristic.
 */
export async function classifyComplexity(
  message: string
): Promise<{ complexity: Complexity; probability: number; model: string } | null> {
  if (!decisionFeatureOn('routerAssist')) return null
  const provider = activeDecisionProvider()
  if (!provider) return null
  const text = message
    .replace(/<file[\s\S]*?<\/file>/g, '')
    .replace(/<skill[\s\S]*?<\/skill>/g, '')
    .trim()
  // Greetings and one-liners: the heuristic is already right, skip the call.
  if (text.length < 24) return null
  // Small local encoders read ~512 tokens; hosted Jev reads far more.
  const cap = provider.local ? 1500 : 6000
  const res = await decide(
    { state: { request: text.slice(0, cap) }, questions: COMPLEXITY_QUESTIONS },
    { purpose: 'routing', timeoutMs: provider.local ? 4000 : 2500, maxRetries: 0 }
  )
  if (!res || !res.ok) return null
  const a = res.answers.complexity
  if (!a || a.type !== 'choice') return null
  const c = a.choice as Complexity
  if (c !== 'simple' && c !== 'medium' && c !== 'complex') return null
  const probability = a.probabilities[c] ?? 0
  if (probability < COMPLEXITY_MIN_PROBABILITY) return null
  return { complexity: c, probability, model: res.model }
}

export function __resetDecisionHarnessForTests(): void {
  riskCache.clear()
  riskInflight.clear()
}
