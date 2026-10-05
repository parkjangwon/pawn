import { buildModsApi, type ModsApiHost } from './api'
import { deepFreeze } from './deepFreeze'
import { matcherMatches } from './match'
import { useModsUiStore } from './uiStore'
import { modConflictLine } from './eventLabel'
import type {
  LoadedModInfo,
  ModCommandReg,
  ModHookHandler,
  ModMatcher,
  ModNext,
  ModOn,
  ModsApi,
  ModTier,
  ModToolReg,
  UiRenderEvent
} from './types'

const HOOK_BUDGET_MS = 10_000
const TIER_ORDER: ModTier[] = ['prepend', 'user', 'append', 'builtin', 'core']

/** prompt.submit shows the model this many characters. An unchanged echo keeps the tail. */
export const MOD_PROMPT_CAP = 200_000

export function applyPromptRewrite(original: string, returned: string): string {
  const seen = original.length > MOD_PROMPT_CAP ? original.slice(0, MOD_PROMPT_CAP) : original
  return returned === seen ? original : returned
}

type RegisterFn = (on: ModOn, options?: Record<string, unknown>) => void | Promise<void>

/**
 * Load a hooks module's `register` export.
 * Prefer ESM (data: / blob:), fall back to a Function wrapper for Node/vitest
 * and single-file mods without relative imports.
 */
async function loadRegisterFn(
  source: string,
  trackUrl: (url: string) => void
): Promise<RegisterFn | null> {
  const candidates: string[] = []
  try {
    if (typeof URL !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([source], { type: 'text/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      trackUrl(blobUrl)
      candidates.push(blobUrl)
    }
  } catch {
    /* no Blob */
  }
  candidates.push('data:text/javascript;charset=utf-8,' + encodeURIComponent(source))

  for (const url of candidates) {
    try {
      const mod = (await import(/* @vite-ignore */ url)) as {
        register?: RegisterFn
        default?: RegisterFn | { register?: RegisterFn }
      }
      const reg = mod.register || (typeof mod.default === 'function' ? mod.default : mod.default?.register)
      if (typeof reg === 'function') return reg
    } catch {
      /* try next / Function fallback */
    }
  }

  // Function fallback: rewrite `export function register` into a return value.
  const rewritten = source
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/export\s+async\s+function\s+register\b/, 'async function register')
    .replace(/export\s+function\s+register\b/, 'function register')
    .replace(/export\s*\{[^}]*\bregister\b[^}]*\}\s*;?/g, '')
    .replace(/export\s+default\s+\{[\s\S]*register[\s\S]*\}\s*;?/g, '')
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(`${rewritten}\n; return typeof register === 'function' ? register : null;`)
    const reg = factory() as RegisterFn | null
    return typeof reg === 'function' ? reg : null
  } catch {
    return null
  }
}

interface HookEntry {
  event: string
  matcher?: ModMatcher
  handler: ModHookHandler
  catchHandler?: ModHookHandler
  plugin: string
  tier: ModTier
  api: ModsApi
}

export interface ModSourcePayload {
  id: string
  name: string
  root: string
  tier: ModTier
  source: string
  userConfig?: Record<string, unknown>
}

export interface ModRuntimeContext {
  sessionId: string
  cwd: string
  projectPath?: string | null
  messages?: () => Array<{ role: string; text: string }>
  contextUsage?: () => { tokens: number; window: number; percent: number }
  submitPrompt?: (text: string, asUser: boolean) => void
  abortTurn?: () => void
}

const BUILTIN_COMMANDS = new Set([
  'new',
  'clear',
  'model',
  'theme',
  'settings',
  'export',
  'plan',
  'build',
  'ultra-work',
  'ulw',
  'record',
  'issue-pr',
  'help',
  'compact',
  'reload-plugins'
])

export class ModRuntime {
  private hooks: HookEntry[] = []
  private commands: ModCommandReg[] = []
  private tools: ModToolReg[] = []
  private loaded: LoadedModInfo[] = []
  private blobUrls: string[] = []
  private ctx: ModRuntimeContext = { sessionId: '', cwd: '' }
  private ready = false
  private lastAnswerPlugin: string | null = null
  private listeners = new Set<() => void>()
  private processEnv: Record<string, string> = {}
  private envOverlay = new Map<string, Record<string, string>>()

  setContext(ctx: Partial<ModRuntimeContext>): void {
    this.ctx = { ...this.ctx, ...ctx }
  }

  /** Subscribe to load/unload/command changes (chat chip, settings badge). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    useModsUiStore.getState().bumpRuntime()
    for (const fn of Array.from(this.listeners)) {
      try {
        fn()
      } catch {
        /* ignore */
      }
    }
  }

  getLoaded(): LoadedModInfo[] {
    return [...this.loaded]
  }

  getActiveMods(): LoadedModInfo[] {
    return this.loaded.filter((m) => m.enabled && m.hooks.length > 0)
  }

  getCommands(): ModCommandReg[] {
    return [...this.commands]
  }

  getTools(): ModToolReg[] {
    return [...this.tools]
  }

  async unload(): Promise<void> {
    if (this.ready) {
      const names = [...new Set(this.loaded.filter((m) => m.enabled).map((m) => m.name))]
      for (const plugin of names) {
        try {
          await this.emit('session.end', { plugin }, async (e) => e)
        } catch {
          /* ending the session must still unload */
        }
      }
    }
    for (const url of this.blobUrls) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }
    this.blobUrls = []
    this.hooks = []
    this.commands = []
    this.tools = []
    this.loaded = []
    this.ready = false
    this.lastAnswerPlugin = null
    this.envOverlay.clear()
    useModsUiStore.getState().clearSessionUi()
    this.notify()
  }

  async load(sources: ModSourcePayload[]): Promise<LoadedModInfo[]> {
    await this.unload()
    await this.refreshProcessEnv()
    for (const src of sources) {
      await this.loadOne(src)
    }
    this.ready = true
    // session.start for each loaded mod (Claude Code: once per mod before first prompt)
    for (const mod of this.loaded.filter((m) => m.enabled)) {
      await this.emit('session.start', { plugin: mod.name }, async (e) => e)
    }
    this.notify()
    return this.getLoaded()
  }

  private async loadOne(src: ModSourcePayload): Promise<void> {
    const hooksBefore = this.hooks.length
    const info: LoadedModInfo = {
      id: src.id,
      name: src.name,
      root: src.root,
      tier: src.tier || 'user',
      enabled: true,
      source: src.root,
      hooks: [],
      calls: []
    }

    const host = this.makeHost(src.name, src.root)
    const api = buildModsApi(host)
    const on = this.makeOn(src.name, src.tier || 'user', api)

    try {
      const register = await loadRegisterFn(src.source, (url) => this.blobUrls.push(url))
      if (typeof register !== 'function') {
        info.enabled = false
        this.loaded.push(info)
        return
      }
      await register(on, src.userConfig || {})
      const newHooks = this.hooks.slice(hooksBefore)
      info.hooks = [...new Set(newHooks.map((h) => h.event))]
      // Approximate calls from source text for UI
      const callRe = /\$\.([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)/g
      const calls = new Set<string>()
      let m: RegExpExecArray | null
      while ((m = callRe.exec(src.source))) calls.add(`$.${m[1]}.${m[2]}`)
      info.calls = [...calls].sort()
      this.loaded.push(info)
    } catch (err) {
      info.enabled = false
      info.hooks = []
      console.warn('[mods] failed to load', src.name, err)
      this.loaded.push(info)
    }
  }

  private makeHost(pluginName: string, pluginRoot: string): ModsApiHost {
    return {
      pluginName,
      pluginRoot,
      sessionId: () => this.ctx.sessionId,
      cwd: () => this.ctx.cwd || this.ctx.projectPath || '',
      getCommands: () => this.commands,
      registerCommand: (cmd) => {
        this.commands = this.commands.filter((c) => c.name.toLowerCase() !== cmd.name.toLowerCase())
        this.commands.push(cmd)
        this.notify()
      },
      getTools: () => this.tools,
      registerTool: (tool) => {
        this.tools = this.tools.filter((t) => t.fullName !== tool.fullName)
        this.tools.push(tool)
        this.notify()
      },
      getEnv: (name) => this.readEnv(pluginName, name),
      setEnv: (name, value) => this.writeEnv(pluginName, name, value),
      envForProcess: () => ({ ...(this.envOverlay.get(pluginName) || {}) }),
      emit: (event, input, core) => this.emit(event, input, core || (async (e) => e)),
      submitPrompt: (text, asUser) => this.ctx.submitPrompt?.(text, asUser),
      abortTurn: () => this.ctx.abortTurn?.(),
      messages: () => this.ctx.messages?.() || [],
      contextUsage: () =>
        this.ctx.contextUsage?.() || { tokens: 0, window: 200_000, percent: 0 },
      reservedCommands: BUILTIN_COMMANDS
    }
  }

  private makeOn(plugin: string, tier: ModTier, api: ModsApi): ModOn {
    return (event, matcherOrHandler, maybeHandler) => {
      let matcher: ModMatcher | undefined
      let handler: ModHookHandler
      if (typeof matcherOrHandler === 'function') {
        handler = matcherOrHandler
      } else {
        matcher = matcherOrHandler
        handler = maybeHandler as ModHookHandler
      }
      if (typeof handler !== 'function') {
        throw new Error(`on('${event}'): handler is not a function`)
      }
      const entry: HookEntry = { event, matcher, handler, plugin, tier, api }
      this.hooks.push(entry)
      return {
        catch: (catchHandler) => {
          entry.catchHandler = catchHandler
        }
      }
    }
  }

  /**
   * Emit an event through the mod middleware chain, then `core`.
   * Matches Claude Code: observe / rewrite via next(e), or answer without next.
   */
  async emit(
    event: string,
    input: unknown,
    core: (e: unknown) => Promise<unknown> = async (e) => e,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (!this.ready && event !== 'session.start') {
      // Allow emit during load of session.start; otherwise pass to core.
      if (this.hooks.length === 0) return core(input)
    }

    const controllers = typeof AbortController !== 'undefined' ? new AbortController() : null
    const combined = signal || controllers?.signal
    this.lastAnswerPlugin = null

    const matched = this.hooks
      .filter((h) => h.event === event && matcherMatches(h.matcher, input))
      .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))

    if (matched.length > 1 && (event === 'tool.call' || event === 'prompt.submit')) {
      const plugins = [...new Set(matched.map((h) => h.plugin))]
      if (plugins.length > 1) {
        useModsUiStore
          .getState()
          .pushTimeline(plugins.join(', '), modConflictLine(event, plugins), 'conflict')
      }
    }

    let index = 0
    let skipUntil: ModTier | null = null

    const runFrom = async (e: unknown, fromTier?: ModTier): Promise<unknown> => {
      if (fromTier) skipUntil = fromTier
      while (index < matched.length) {
        const entry = matched[index++]
        if (skipUntil) {
          const entryIdx = TIER_ORDER.indexOf(entry.tier)
          const skipIdx = TIER_ORDER.indexOf(skipUntil)
          if (entryIdx < skipIdx) continue
          skipUntil = null
        }

        const started = Date.now()
        const budget = {
          ms: HOOK_BUDGET_MS,
          get remainingMs() {
            return Math.max(0, HOOK_BUDGET_MS - (Date.now() - started))
          }
        }

        let nextCalled = false
        const next = ((nextEvent: unknown) => {
          nextCalled = true
          return runFrom(nextEvent)
        }) as ModNext

        next.signal = combined || new AbortController().signal
        next.origin = { plugin: entry.plugin, tier: entry.tier }
        next.budget = budget
        next.to = (nextEvent, tier) => {
          nextCalled = true
          return runFrom(nextEvent, tier)
        }

        try {
          const result = await Promise.race([
            Promise.resolve(entry.handler(entry.api, deepFreeze(e), next)),
            new Promise<never>((_, reject) => {
              const t = setTimeout(() => reject(new Error('hook timeout')), HOOK_BUDGET_MS)
              if (combined) {
                combined.addEventListener('abort', () => {
                  clearTimeout(t)
                  reject(new Error('hook aborted'))
                }, { once: true })
              }
            })
          ])
          if (!nextCalled) {
            this.lastAnswerPlugin = entry.plugin
            return result
          }
          return result
        } catch (err) {
          if (entry.catchHandler) {
            const catchNext = next
            catchNext.error = {
              kind: err instanceof Error && err.message === 'hook timeout' ? 'timeout' : 'throw',
              message: err instanceof Error ? err.message : String(err)
            }
            catchNext.called = nextCalled
            try {
              const caught = await entry.catchHandler(entry.api, deepFreeze(e), catchNext)
              if (!nextCalled) this.lastAnswerPlugin = entry.plugin
              return caught
            } catch {
              /* fall through */
            }
          }
          console.warn(`[mods] ${entry.plugin} ${event} failed:`, err)
          // Skip failed hook; continue chain
          continue
        }
      }
      return core(e)
    }

    return runFrom(input)
  }

  /** Convenience: tool.call with deny/result short-circuit. */
  async emitToolCall<T extends { result: string; isError?: boolean }>(
    tool: string,
    args: Record<string, unknown>,
    run: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<{
    deny?: string
    result?: string
    isError?: boolean
    handled: boolean
    plugin?: string
    core?: T
  }> {
    let coreRan = false
    let coreResult: T | undefined
    const out = await this.emit(
      'tool.call',
      { tool, ...args },
      async () => {
        coreRan = true
        coreResult = await run()
        return coreResult
      },
      signal
    )
    const plugin = this.lastAnswerPlugin || undefined
    if (!coreRan && out && typeof out === 'object') {
      const o = out as { deny?: string; result?: unknown }
      if (typeof o.deny === 'string') return { deny: o.deny, handled: true, plugin }
      if ('result' in o) {
        return {
          result: typeof o.result === 'string' ? o.result : JSON.stringify(o.result),
          handled: true,
          plugin
        }
      }
    }
    if (coreResult) {
      return {
        result: coreResult.result,
        isError: coreResult.isError,
        handled: false,
        core: coreResult
      }
    }
    return { handled: false }
  }

  async emitPromptSubmit(
    text: string,
    signal?: AbortSignal
  ): Promise<{ text: string; drop?: string; context?: unknown }> {
    const out = await this.emit(
      'prompt.submit',
      { text },
      async (e) => e,
      signal
    )
    if (out && typeof out === 'object') {
      const o = out as { drop?: string; text?: string; context?: unknown }
      if (typeof o.drop === 'string') return { text, drop: o.drop }
      if (typeof o.text === 'string') return { text: o.text, context: o.context }
    }
    return { text }
  }

  async emitCommandRun(
    command: string,
    args: string
  ): Promise<{ text?: string; handled: boolean }> {
    const hasHandler = this.hooks.some(
      (h) => h.event === 'command.run' && matcherMatches(h.matcher, { command, args })
    )
    if (!hasHandler && !this.commands.some((c) => c.name === command)) {
      return { handled: false }
    }
    let coreRan = false
    const out = await this.emit(
      'command.run',
      { command, args },
      async () => {
        coreRan = true
        return {}
      }
    )
    if (!coreRan && out && typeof out === 'object') {
      return { ...(out as { text?: string }), handled: true }
    }
    return { handled: hasHandler }
  }

  private async refreshProcessEnv(): Promise<void> {
    try {
      const snap = await window.api?.mods?.envSnapshot?.()
      if (snap?.values && typeof snap.values === 'object') this.processEnv = snap.values
    } catch {
      this.processEnv = {}
    }
  }

  private readEnv(plugin: string, name: string): string | undefined {
    if (!name) return undefined
    const over = this.envOverlay.get(plugin)
    if (over && Object.prototype.hasOwnProperty.call(over, name)) return over[name]
    return this.processEnv[name]
  }

  private writeEnv(plugin: string, name: string, value: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) return
    const cur = { ...(this.envOverlay.get(plugin) || {}) }
    cur[name] = value
    this.envOverlay.set(plugin, cur)
  }

  /** One hook, with `next` returning the event instead of continuing the chain. */
  private async callIsolated(entry: HookEntry, input: unknown): Promise<unknown> {
    const started = Date.now()
    const budget = {
      ms: HOOK_BUDGET_MS,
      get remainingMs() {
        return Math.max(0, HOOK_BUDGET_MS - (Date.now() - started))
      }
    }
    const next = ((event: unknown) => Promise.resolve(event)) as ModNext
    next.signal = new AbortController().signal
    next.origin = { plugin: entry.plugin, tier: entry.tier }
    next.budget = budget
    next.to = (event) => Promise.resolve(event)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve(entry.handler(entry.api, deepFreeze(input), next)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('hook timeout')), HOOK_BUDGET_MS)
        })
      ])
    } catch (err) {
      if (entry.catchHandler) {
        try {
          return await entry.catchHandler(entry.api, deepFreeze(input), next)
        } catch {
          return input
        }
      }
      console.warn(`[mods] ${entry.plugin} ui.render failed:`, err)
      return input
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async collectAboveBands(
    base: Record<string, unknown>
  ): Promise<Array<{ plugin: string; tree: unknown }>> {
    const probe = {
      component: 'AbovePrompt',
      surface: 'desktop',
      props: { ...base },
      requestId: 'above-prompt'
    }
    const matched = this.hooks.filter((h) => h.event === 'ui.render' && matcherMatches(h.matcher, probe))
    const bands: Array<{ plugin: string; tree: unknown }> = []
    for (const entry of matched) {
      const event = {
        component: 'AbovePrompt',
        surface: 'desktop' as const,
        props: { ...base, plugin: entry.plugin },
        requestId: 'above-prompt'
      }
      const out = await this.callIsolated(entry, event)
      if (!out || typeof out !== 'object') continue
      const props = (out as { props?: Record<string, unknown> }).props
      const tree = props?.tree ?? props?.children
      if (tree == null) continue
      const plugin = typeof props?.plugin === 'string' && props.plugin ? props.plugin : entry.plugin
      bands.push({ plugin, tree })
    }
    return bands
  }

  async emitUiRender(component: string, props: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (component === 'AbovePrompt') {
      const bands = await this.collectAboveBands(props)
      useModsUiStore.getState().setAbovePrompts(bands)
      const first = bands[0]
      return first ? { ...props, plugin: first.plugin, tree: first.tree } : { ...props }
    }
    const event: UiRenderEvent = {
      component,
      surface: 'desktop',
      props,
      requestId: component === 'AbovePrompt' ? 'above-prompt' : undefined
    }
    const out = await this.emit('ui.render', event, async (e) => e)
    let nextProps = props
    if (out && typeof out === 'object' && 'props' in (out as object)) {
      nextProps = ((out as UiRenderEvent).props || props) as Record<string, unknown>
    } else if (out && typeof out === 'object' && 'component' in (out as object)) {
      nextProps = ((out as UiRenderEvent).props || props) as Record<string, unknown>
    }
    return nextProps
  }

  /** Event → plugins that registered a handler (for conflict / priority UI). */
  getHookCoverage(): Record<string, string[]> {
    const map: Record<string, string[]> = {}
    for (const h of this.hooks) {
      const list = map[h.event] || (map[h.event] = [])
      if (!list.includes(h.plugin)) list.push(h.plugin)
    }
    return map
  }

  /** Events with 2+ plugins — order is middleware tier order. */
  getConflicts(): Array<{ event: string; plugins: string[] }> {
    return Object.entries(this.getHookCoverage())
      .filter(([, plugins]) => plugins.length > 1)
      .map(([event, plugins]) => ({ event, plugins }))
  }

  async refreshSpinnerSuffix(base: Record<string, unknown> = {}): Promise<string> {
    const props = await this.emitUiRender('Spinner', {
      word: 'Thinking',
      message: '',
      suffix: '',
      mode: 'thinking',
      ...base
    })
    const suffix = typeof props.suffix === 'string' ? props.suffix : ''
    useModsUiStore.getState().setSpinnerSuffix(suffix)
    return suffix
  }
}

/** Singleton runtime for the active desktop / headless session. */
let singleton: ModRuntime | null = null

export function getModRuntime(): ModRuntime {
  if (!singleton) singleton = new ModRuntime()
  return singleton
}

export function __resetModRuntimeForTests(): void {
  void singleton?.unload()
  singleton = null
}
