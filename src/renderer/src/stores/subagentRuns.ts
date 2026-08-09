/**
 * Live subagent run registry for UI observability + background orchestration.
 * Controllers/promises live module-side so cancel/await work across tools.
 */
import { create } from 'zustand'

export type SubagentRunStatus = 'running' | 'ok' | 'error' | 'aborted'

export type SubagentRunUsage = {
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  cacheHitRate: number
  modelLabel?: string
}

export type SubagentRun = {
  id: string
  name: string
  /** Profile name (explore/worker/custom). */
  agent: string
  /** Legacy UI field. */
  mode: 'explore' | 'worker'
  status: SubagentRunStatus
  parentSessionId: string
  projectId?: string
  background: boolean
  startedAt: number
  finishedAt?: number
  rounds: number
  maxRounds?: number
  toolsUsed: string[]
  /** Most recent tool name (live progress). */
  lastTool?: string
  isolation?: 'none' | 'worktree'
  worktreePath?: string
  summary?: string
  error?: string
  filesChanged?: string[]
  applied?: boolean
  applyConflicts?: string[]
  /** Short preview for list cards. */
  promptPreview?: string
  /** Full prompt for re-run (capped). */
  promptFull?: string
  /** Groups tasks from one parallel_agents call. */
  batchId?: string
  /** Live cost/cache stats for Agents panel. */
  usage?: SubagentRunUsage
}

export type SessionSubagentTotals = {
  running: number
  ok: number
  failed: number
  cost: number
  cacheHitRate: number
  calls: number
}

interface SubagentRunsState {
  runs: SubagentRun[]
  start: (
    run: Omit<
      SubagentRun,
      'status' | 'startedAt' | 'rounds' | 'toolsUsed' | 'background' | 'agent' | 'mode'
    > & {
      agent?: string
      mode?: 'explore' | 'worker'
      background?: boolean
      rounds?: number
      toolsUsed?: string[]
    }
  ) => void
  tick: (
    id: string,
    patch: Partial<
      Pick<
        SubagentRun,
        | 'rounds'
        | 'toolsUsed'
        | 'worktreePath'
        | 'isolation'
        | 'usage'
        | 'lastTool'
        | 'maxRounds'
      >
    >
  ) => void
  finish: (
    id: string,
    patch: {
      status: SubagentRunStatus
      summary?: string
      error?: string
      rounds?: number
      toolsUsed?: string[]
      filesChanged?: string[]
      applied?: boolean
      applyConflicts?: string[]
      usage?: SubagentRunUsage
    }
  ) => void
  clearFinished: () => void
  clearFinishedForSession: (sessionId: string) => void
  cancel: (id: string) => boolean
  cancelAllForSession: (sessionId: string) => number
  activeForSession: (sessionId: string) => SubagentRun[]
  recentForSession: (sessionId: string, limit?: number) => SubagentRun[]
  getById: (id: string) => SubagentRun | undefined
  findRunning: (query: string) => SubagentRun | undefined
  /** Resolve id, name, or agent — prefer running, else most recent. */
  resolve: (query: string) => SubagentRun | undefined
  totalsForSession: (sessionId: string) => SessionSubagentTotals
  runsForBatch: (batchId: string) => SubagentRun[]
}

const MAX_HISTORY = 80
const PROMPT_FULL_CAP = 6_000

/** Per-run abort — independent of the parent turn signal when background. */
const controllers = new Map<string, AbortController>()
/** Resolve when a run finishes (for await_agent). */
const waiters = new Map<string, Array<(run: SubagentRun) => void>>()
/** Result promises keyed by run id. */
const results = new Map<string, Promise<SubagentRun>>()

export function registerSubagentController(id: string, controller: AbortController): void {
  controllers.set(id, controller)
}

export function getSubagentController(id: string): AbortController | undefined {
  return controllers.get(id)
}

export function registerSubagentResultPromise(id: string, promise: Promise<SubagentRun>): void {
  results.set(id, promise)
  void promise.finally(() => {
    controllers.delete(id)
  })
}

function notifyWaiters(run: SubagentRun): void {
  const keys = new Set<string>([run.id, run.name, run.agent])
  for (const key of keys) {
    if (!key) continue
    const list = waiters.get(key)
    if (!list) continue
    waiters.delete(key)
    for (const fn of list) {
      try {
        fn(run)
      } catch {
        /* ignore */
      }
    }
  }
}

function resolveRun(query: string): SubagentRun | undefined {
  const store = useSubagentRunsStore.getState()
  const q = query.trim()
  if (!q) return undefined
  const byId = store.getById(q)
  if (byId) return byId
  const running = store.findRunning(q)
  if (running) return running
  const ql = q.toLowerCase()
  // Most recent match by name (running preferred via list order).
  return store.runs.find(
    (r) => r.name.toLowerCase() === ql || r.id.toLowerCase() === ql || r.agent.toLowerCase() === ql
  )
}

export function waitForSubagentRun(
  idOrName: string,
  timeoutMs = 600_000
): Promise<SubagentRun> {
  const existing = resolveRun(idOrName)

  if (existing && existing.status !== 'running') {
    return Promise.resolve(existing)
  }

  const id = existing?.id || idOrName
  const pending = results.get(id)
  if (pending) {
    return Promise.race([
      pending,
      new Promise<SubagentRun>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timed out waiting for subagent ${idOrName}`)),
          timeoutMs
        )
      )
    ])
  }

  return new Promise<SubagentRun>((resolve, reject) => {
    const timer = setTimeout(() => {
      const arr = waiters.get(id)
      if (arr) waiters.set(id, arr.filter((f) => f !== onDone))
      // Also clean name key
      const byName = waiters.get(idOrName)
      if (byName) waiters.set(idOrName, byName.filter((f) => f !== onDone))
      reject(new Error(`Timed out waiting for subagent ${idOrName}`))
    }, timeoutMs)
    function onDone(run: SubagentRun): void {
      clearTimeout(timer)
      resolve(run)
    }
    for (const key of [id, idOrName]) {
      if (!key) continue
      const arr = waiters.get(key) || []
      arr.push(onDone)
      waiters.set(key, arr)
    }
    // Re-check in case it finished between lookups.
    const now = resolveRun(idOrName)
    if (now && now.status !== 'running') {
      clearTimeout(timer)
      for (const key of [id, idOrName]) {
        waiters.set(
          key,
          (waiters.get(key) || []).filter((f) => f !== onDone)
        )
      }
      resolve(now)
    }
  })
}

/** Wait for every currently-running subagent in a session (snapshot at call time). */
export async function waitForSessionSubagents(
  sessionId: string,
  timeoutMs = 600_000
): Promise<SubagentRun[]> {
  const active = useSubagentRunsStore.getState().activeForSession(sessionId)
  if (!active.length) return []
  return Promise.all(active.map((r) => waitForSubagentRun(r.id, timeoutMs)))
}

export function sessionTotals(runs: SubagentRun[]): SessionSubagentTotals {
  let running = 0
  let ok = 0
  let failed = 0
  let cost = 0
  let cacheRead = 0
  let cacheDen = 0
  let calls = 0
  for (const r of runs) {
    if (r.status === 'running') running++
    else if (r.status === 'ok') ok++
    else failed++
    if (r.usage && r.usage.calls > 0) {
      cost += r.usage.cost
      calls += r.usage.calls
      cacheRead += r.usage.cacheReadTokens
      cacheDen += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens
    }
  }
  return {
    running,
    ok,
    failed,
    cost,
    calls,
    cacheHitRate: cacheDen > 0 ? cacheRead / cacheDen : 0
  }
}

export const useSubagentRunsStore = create<SubagentRunsState>((set, get) => ({
  runs: [],

  start: (run) => {
    const agent = run.agent || (run.mode === 'worker' ? 'worker' : 'explore')
    const promptFull = run.promptFull
      ? run.promptFull.slice(0, PROMPT_FULL_CAP)
      : run.promptPreview?.slice(0, PROMPT_FULL_CAP)
    const entry: SubagentRun = {
      ...run,
      agent,
      mode: run.mode || (agent === 'worker' ? 'worker' : 'explore'),
      background: run.background === true,
      status: 'running',
      startedAt: Date.now(),
      rounds: run.rounds ?? 0,
      toolsUsed: run.toolsUsed ?? [],
      promptFull,
      promptPreview: run.promptPreview || promptFull?.slice(0, 200)
    }
    set((s) => ({
      runs: [entry, ...s.runs].slice(0, MAX_HISTORY)
    }))
  },

  tick: (id, patch) => {
    set((s) => ({
      runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r))
    }))
  },

  finish: (id, patch) => {
    let finished: SubagentRun | undefined
    set((s) => ({
      runs: s.runs.map((r) => {
        if (r.id !== id) return r
        finished = {
          ...r,
          ...patch,
          finishedAt: Date.now()
        }
        return finished
      })
    }))
    controllers.delete(id)
    if (finished) notifyWaiters(finished)
  },

  clearFinished: () => {
    set((s) => ({ runs: s.runs.filter((r) => r.status === 'running') }))
  },

  clearFinishedForSession: (sessionId) => {
    set((s) => ({
      runs: s.runs.filter(
        (r) => r.status === 'running' || r.parentSessionId !== sessionId
      )
    }))
  },

  cancel: (id) => {
    const c = controllers.get(id)
    const run = get().getById(id)
    if (!run || run.status !== 'running') return false
    if (c && !c.signal.aborted) c.abort()
    get().finish(id, {
      status: 'aborted',
      error: 'cancelled',
      summary: run.summary || 'Cancelled',
      rounds: run.rounds,
      toolsUsed: run.toolsUsed
    })
    return true
  },

  cancelAllForSession: (sessionId) => {
    let n = 0
    for (const r of get().activeForSession(sessionId)) {
      if (get().cancel(r.id)) n++
    }
    return n
  },

  activeForSession: (sessionId) =>
    get().runs.filter((r) => r.parentSessionId === sessionId && r.status === 'running'),

  recentForSession: (sessionId, limit = 8) =>
    get()
      .runs.filter((r) => r.parentSessionId === sessionId)
      .slice(0, limit),

  getById: (id) => get().runs.find((r) => r.id === id),

  findRunning: (query) => {
    const q = query.trim().toLowerCase()
    return get().runs.find(
      (r) =>
        r.status === 'running' &&
        (r.id === query ||
          r.id.toLowerCase() === q ||
          r.name.toLowerCase() === q ||
          r.agent.toLowerCase() === q)
    )
  },

  resolve: (query) => resolveRun(query),

  totalsForSession: (sessionId) =>
    sessionTotals(get().runs.filter((r) => r.parentSessionId === sessionId)),

  runsForBatch: (batchId) => get().runs.filter((r) => r.batchId === batchId)
}))
