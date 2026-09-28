import { create } from 'zustand'
import {
  EVALUATOR_SYSTEM_PROMPT,
  continuationPrompt,
  parseVerdict,
  selfReportedVerdict,
  type GoalVerdict,
  type UltraWorkRun,
  type UltraWorkStatus
} from '../agent/ultraWork'
import { fetchWithRetry } from '../agent/llm'
import { pickSummaryModel, parseSummaryResponse, renderForSummary } from '../agent/compaction'
import { prepareSideCall } from '../agent/subscriptionSession'
import type { TranscriptEntry } from '../agent/transcript'
import { useUsageStore } from './usage'
import { setUltraWorkSession } from './ultraWorkRegistry'

/**
 * Active Ultra Work runs, one per session. The agent loop consults this store
 * to force MAXING, inject the contract, and decide whether to continue.
 */
interface UltraWorkState {
  runs: Record<string, UltraWorkRun>
  start: (sessionId: string, goal: string, maxIterations: number) => UltraWorkRun
  /** Stop by the user (Stop button / Esc on the banner). */
  stop: (sessionId: string) => void
  /** Clear a finished run's banner. */
  dismiss: (sessionId: string) => void
  isActive: (sessionId: string | null | undefined) => boolean
  get: (sessionId: string | null | undefined) => UltraWorkRun | undefined
  /** Internal: record progress / end the run. */
  update: (sessionId: string, patch: Partial<UltraWorkRun>) => void
}

function spendFor(sessionId: string): { cost: number; tokens: number } {
  try {
    const t = useUsageStore.getState().totalsFor(sessionId)
    return { cost: t.cost || 0, tokens: (t.inputTokens || 0) + (t.outputTokens || 0) + (t.cacheReadTokens || 0) }
  } catch {
    return { cost: 0, tokens: 0 }
  }
}

export const useUltraWorkStore = create<UltraWorkState>((set, get) => ({
  runs: {},

  start: (sessionId, goal, maxIterations) => {
    const spend = spendFor(sessionId)
    const run: UltraWorkRun = {
      sessionId,
      goal,
      status: 'active',
      iteration: 1,
      maxIterations,
      startedAt: Date.now(),
      baseCost: spend.cost,
      baseTokens: spend.tokens
    }
    set((s) => ({ runs: { ...s.runs, [sessionId]: run } }))
    return run
  },

  stop: (sessionId) => {
    const run = get().runs[sessionId]
    if (!run || run.status !== 'active') return
    get().update(sessionId, { status: 'stopped', endedAt: Date.now() })
  },

  dismiss: (sessionId) => {
    setUltraWorkSession(sessionId, false)
    set((s) => {
      const { [sessionId]: _, ...rest } = s.runs
      return { runs: rest }
    })
  },

  isActive: (sessionId) => !!sessionId && get().runs[sessionId]?.status === 'active',

  get: (sessionId) => (sessionId ? get().runs[sessionId] : undefined),

  update: (sessionId, patch) => {
    set((s) => {
      const run = s.runs[sessionId]
      if (!run) return s
      return { runs: { ...s.runs, [sessionId]: { ...run, ...patch } } }
    })
  }
}))

// Mirror active runs into the registry the provider store reads.
useUltraWorkStore.subscribe((s) => {
  for (const [id, run] of Object.entries(s.runs)) setUltraWorkSession(id, run.status === 'active')
})

/** Run spend since the goal started. */
export function ultraWorkSpend(run: UltraWorkRun): { cost: number; tokens: number } {
  const now = spendFor(run.sessionId)
  return { cost: Math.max(0, now.cost - run.baseCost), tokens: Math.max(0, now.tokens - run.baseTokens) }
}

const EVAL_TIMEOUT_MS = 40_000

/**
 * Ask a cheap model whether the goal is met. Null when no evaluator is
 * reachable (caller falls back to the agent's self-report).
 */
export async function evaluateGoal(
  goal: string,
  entries: TranscriptEntry[],
  sessionId: string,
  signal?: AbortSignal
): Promise<GoalVerdict | null> {
  // The latest work matters most; keep the tail.
  const text = renderForSummary(entries.slice(-60), 40_000)
  const target = pickSummaryModel(Math.ceil(text.length / 3))
  if (!target) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EVAL_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const user = `GOAL:\n${goal}\n\nTRANSCRIPT (latest part):\n${text}\n\nIs the goal met? JSON only.`
  const body =
    target.provider.apiFormat === 'claude'
      ? { model: target.model.modelId, max_tokens: 300, system: EVALUATOR_SYSTEM_PROMPT, messages: [{ role: 'user', content: user }] }
      : {
          model: target.model.modelId,
          max_tokens: 300,
          stream: false,
          messages: [
            { role: 'system', content: EVALUATOR_SYSTEM_PROMPT },
            { role: 'user', content: user }
          ]
        }
  try {
    const call = await prepareSideCall(target.provider, body)
    const res = await fetchWithRetry(
      call.url,
      call.headers,
      call.body,
      window.api?.platform === 'browser',
      combined
    )
    const parsed = parseSummaryResponse(await res.json())
    try {
      useUsageStore.getState().record(sessionId, target.model, parsed.usage)
    } catch {
      /* best effort */
    }
    return parseVerdict(parsed.text)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface AfterTurnDecision {
  action: 'continue' | 'end'
  status?: UltraWorkStatus
  prompt?: string
  reason?: string
}

/**
 * Decide what happens after an Ultra Work turn. The agent's self-report wins
 * for "blocked"; "done" must be confirmed by the evaluator when one exists
 * (agents over-claim). Pure except for the injected evaluator.
 */
export async function decideAfterTurn(
  run: UltraWorkRun,
  finalText: string,
  entries: TranscriptEntry[],
  evaluate: (goal: string, entries: TranscriptEntry[]) => Promise<GoalVerdict | null>
): Promise<AfterTurnDecision> {
  const self = selfReportedVerdict(finalText)
  if (self?.blocked) return { action: 'end', status: 'unmet', reason: self.reason }
  const verdict = (await evaluate(run.goal, entries)) ?? self
  if (verdict?.met) return { action: 'end', status: 'achieved', reason: verdict.reason }
  if (verdict?.blocked) return { action: 'end', status: 'unmet', reason: verdict.reason }
  if (run.iteration >= run.maxIterations) {
    return { action: 'end', status: 'budget_limited', reason: verdict?.reason || 'Iteration budget used up.' }
  }
  const next = { ...run, iteration: run.iteration + 1 }
  return { action: 'continue', prompt: continuationPrompt(next, verdict?.reason), reason: verdict?.reason }
}
