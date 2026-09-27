/**
 * Headless agent runner: drives the real agent loop (router, tools, stores)
 * in plain Node with a Node-backed `window.api`.
 *
 * Used by the `pawn-headless` CLI and the evaluation harness. Interactive
 * surfaces are answered by policy: permission prompts follow `permission`,
 * `ask_user` gets the recommended (first) option, plan approval follows
 * `autoApprovePlan`.
 */

import { createNodeApi, type HeadlessConfig } from './nodeApi'

export type HeadlessPermission = 'auto' | 'yolo' | 'deny'

export interface HeadlessTurnOptions {
  prompt: string
  cwd: string
  config: HeadlessConfig
  harnessMode?: 'default' | 'eco' | 'maxing'
  /** Pin a model (ModelEntry id); omitted = auto routing. */
  modelId?: string
  agentMode?: 'plan' | 'build'
  permission?: HeadlessPermission
  autoApprovePlan?: boolean
  timeoutMs?: number
  /** Hide the user's personal skills / CLAUDE.md (reproducible evals). */
  homeDir?: string
  /** Give the agent real desktop control (macOS native helper). */
  computer?: boolean
  /** Run as a General chat (no project folder) — tests the shared workspace. */
  noProject?: boolean
  /** Run as an Ultra Work goal loop (prompt = goal). */
  ultraWork?: { maxIterations?: number }
  onLog?: (line: string) => void
}

export interface HeadlessToolRecord {
  name: string
  status: 'ok' | 'error'
  target?: string
  durationMs?: number
  added?: number
  removed?: number
}

export interface HeadlessTurnResult {
  ok: boolean
  /** completed | timeout | error */
  outcome: 'completed' | 'timeout' | 'error'
  error?: string
  finalText: string
  assistantMessages: number
  tools: HeadlessToolRecord[]
  usage: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number }
  durationMs: number
  models: string[]
  /** Questions / permission prompts answered by policy. */
  autoAnswers: string[]
  /** Ultra Work outcome when run as a goal loop. */
  ultraWork?: { status: string; iterations: number; reason?: string }
}

let installed: { dispose: () => void } | null = null

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v))
  } as Storage
}

/** Minimal browser globals the renderer modules touch at import/run time. */
export function installHeadlessGlobals(api: Record<string, unknown>): void {
  const g = globalThis as Record<string, any>
  if (typeof g.window === 'undefined') {
    const win = new EventTarget() as unknown as Record<string, any>
    for (const k of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'fetch', 'AbortController', 'AbortSignal', 'URL', 'TextDecoder', 'TextEncoder']) {
      win[k] = g[k]
    }
    win.innerWidth = 1280
    win.innerHeight = 800
    win.getSelection = () => null
    g.window = win
  }
  const win = g.window as Record<string, any>
  win.api = api
  if (typeof g.localStorage === 'undefined' || !g.localStorage?.getItem) {
    Object.defineProperty(g, 'localStorage', { value: memoryStorage(), configurable: true, writable: true })
  }
  win.localStorage = g.localStorage
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number
    g.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
  }
  win.requestAnimationFrame = g.requestAnimationFrame
  win.cancelAnimationFrame = g.cancelAnimationFrame
  const mm = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  if (typeof win.matchMedia !== 'function') win.matchMedia = mm
  if (typeof g.document === 'undefined') {
    g.document = {
      hasFocus: () => false,
      documentElement: { style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, lang: '', classList: { add() {}, remove() {} } },
      body: { classList: { add() {}, remove() {} }, style: {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      head: { appendChild() {} }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Run one user turn to completion. */
export async function runHeadlessTurn(opts: HeadlessTurnOptions): Promise<HeadlessTurnResult> {
  const started = Date.now()
  const log = opts.onLog ?? (() => {})
  const { api, dispose } = createNodeApi({ config: opts.config, onLog: log, homeDir: opts.homeDir, computer: opts.computer })
  installed?.dispose()
  installed = { dispose }
  installHeadlessGlobals(api)

  // Import after globals exist (stores read window/localStorage at import).
  const [
    { useAppStore },
    { useChatStore },
    { useProviderStore },
    { usePrefsStore },
    { useUsageStore },
    { usePermissionStore },
    { useQuestionStore },
    { useUltraWorkStore }
  ] = await Promise.all([
    import('../renderer/src/stores/app'),
    import('../renderer/src/stores/chat'),
    import('../renderer/src/stores/provider'),
    import('../renderer/src/stores/prefs'),
    import('../renderer/src/stores/usage'),
    import('../renderer/src/stores/permission'),
    import('../renderer/src/stores/userQuestions'),
    import('../renderer/src/stores/ultraWork')
  ])

  useProviderStore.setState({ initialized: false })
  await useProviderStore.getState().init()
  usePrefsStore.setState({ initialized: false })
  await usePrefsStore.getState().init().catch(() => {})
  const provider = useProviderStore.getState()
  useProviderStore.setState({
    permissionMode: opts.permission === 'deny' ? 'ask' : (opts.permission ?? 'auto'),
    harnessMode: opts.harnessMode ?? provider.harnessMode,
    agentMode: opts.agentMode ?? 'build',
    sessionAgentModes: {},
    // Same default as the desktop app (post-edit diagnostics from language servers).
    lspDiagnostics: typeof api.lsp?.diagnostics === 'function',
    ...(opts.modelId ? { routingMode: 'manual' as const, activeModelId: opts.modelId } : {})
  })
  usePrefsStore.setState({ taskNotificationsEnabled: false })

  const projectId = `headless-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  useAppStore.getState().addProject('headless', opts.noProject ? [] : [opts.cwd], projectId)
  const sessionId = useAppStore.getState().addSession(projectId, opts.prompt.slice(0, 40))
  useAppStore.setState((s) => ({ loadedSessions: new Set([...s.loadedSessions, sessionId]) }))

  const autoAnswers: string[] = []
  const handled = new Set<string>()
  const unsubPerm = usePermissionStore.subscribe((s) => {
    for (const p of s.pending) {
      if (p.sessionId && p.sessionId !== sessionId) continue
      if (handled.has(p.id)) continue
      handled.add(p.id)
      const approve = opts.permission === 'yolo' || opts.permission === 'auto' || opts.permission === undefined
      autoAnswers.push(`${approve ? 'approved' : 'denied'} permission: ${p.description}`)
      queueMicrotask(() => usePermissionStore.getState().resolve(p.id, approve))
    }
  })
  const unsubQ = useQuestionStore.subscribe((s) => {
    for (const q of s.pending) {
      if (q.sessionId !== sessionId || handled.has(q.id)) continue
      handled.add(q.id)
      queueMicrotask(() => {
        if (q.kind === 'plan_approval') {
          const pick = opts.autoApprovePlan ? q.options[0]?.label : undefined
          autoAnswers.push(`plan ${pick ? 'approved' : 'dismissed'}`)
          useQuestionStore.getState().answer(q.id, pick ? { selected: [pick] } : { selected: [], dismissed: true })
          return
        }
        const first = q.options[0]?.label
        autoAnswers.push(`asked "${q.question}" → ${first ?? '(no options, dismissed)'}`)
        useQuestionStore
          .getState()
          .answer(q.id, first ? { selected: [first], text: 'Headless run: picked the recommended option.' } : { selected: [], dismissed: true })
      })
    }
  })

  let outcome: HeadlessTurnResult['outcome'] = 'completed'
  let error: string | undefined
  try {
    if (opts.ultraWork) {
      useUltraWorkStore.getState().start(sessionId, opts.prompt, Math.max(1, Math.min(40, opts.ultraWork.maxIterations ?? 12)))
    }
    useChatStore.getState().sendMessage(projectId, sessionId, opts.prompt, 'steer')
    const deadline = started + (opts.timeoutMs ?? 15 * 60_000)
    // Wait for the turn (and anything it queued, and Ultra Work iterations) to settle.
    await sleep(20)
    let idleSince = 0
    for (;;) {
      const chat = useChatStore.getState()
      const ulwActive = useUltraWorkStore.getState().isActive(sessionId)
      const busyNow = chat.streamingSessionIds.includes(sessionId) || chat.queue.some((q) => q.sessionId === sessionId)
      // Between Ultra Work iterations the session is briefly idle; wait it out.
      if (!busyNow && ulwActive) idleSince = idleSince || Date.now()
      else idleSince = 0
      const busy = busyNow || (ulwActive && Date.now() - idleSince < 60_000)
      if (!busy) break
      if (Date.now() > deadline) {
        outcome = 'timeout'
        useChatStore.getState().stopStreaming(sessionId)
        await sleep(200)
        break
      }
      await sleep(100)
    }
  } catch (err) {
    outcome = 'error'
    error = err instanceof Error ? err.message : String(err)
  } finally {
    unsubPerm()
    unsubQ()
  }

  const session = useAppStore
    .getState()
    .projects.find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
  const messages = session?.messages ?? []
  const assistant = messages.filter((m) => m.role === 'assistant' && m.content.trim())
  const tools: HeadlessToolRecord[] = messages
    .filter((m) => m.role === 'system' && m.toolMeta)
    .map((m) => ({
      name: m.toolMeta!.name,
      status: m.toolMeta!.status,
      target: m.toolMeta!.target,
      durationMs: m.toolMeta!.durationMs,
      added: m.toolMeta!.added,
      removed: m.toolMeta!.removed
    }))
  const errorsShown = messages.filter((m) => m.role === 'system' && !m.toolMeta).map((m) => m.content)
  const totals = useUsageStore.getState().bySession[sessionId]
  const models = [...new Set(messages.map((m) => m.modelLabel).filter((x): x is string => !!x))]
  const route = useUsageStore.getState().lastRoute[sessionId]
  if (route?.label && !models.includes(route.label)) models.push(route.label)
  if (!error && assistant.length === 0 && errorsShown.length) error = errorsShown[errorsShown.length - 1].slice(0, 500)

  const ulw = opts.ultraWork ? useUltraWorkStore.getState().get(sessionId) : undefined
  if (ulw?.status === 'active') useUltraWorkStore.getState().stop(sessionId)
  dispose()
  installed = null
  return {
    ...(ulw ? { ultraWork: { status: ulw.status === 'active' ? 'stopped' : ulw.status, iterations: ulw.iteration, reason: ulw.lastReason } } : {}),
    ok: outcome === 'completed' && !error,
    outcome: error && outcome === 'completed' ? 'error' : outcome,
    ...(error ? { error } : {}),
    finalText: assistant[assistant.length - 1]?.content ?? '',
    assistantMessages: assistant.length,
    tools,
    usage: {
      calls: totals?.calls ?? 0,
      inputTokens: totals?.inputTokens ?? 0,
      outputTokens: totals?.outputTokens ?? 0,
      cacheReadTokens: totals?.cacheReadTokens ?? 0,
      cacheWriteTokens: totals?.cacheWriteTokens ?? 0,
      cost: totals?.cost ?? 0
    },
    durationMs: Date.now() - started,
    models,
    autoAnswers
  }
}
