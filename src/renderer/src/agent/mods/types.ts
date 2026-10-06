/** Renderer-side Claude Code–compatible mods types. */

export type ModTier = 'prepend' | 'user' | 'append' | 'builtin' | 'core'

export interface ModOrigin {
  plugin: string
  tier: ModTier
}

export interface ModBudget {
  ms: number
  remainingMs: number
}

export interface ModNext {
  (event: unknown): Promise<unknown>
  signal: AbortSignal
  origin: ModOrigin
  budget: ModBudget
  to: (event: unknown, tier: 'append' | 'builtin' | 'core') => Promise<unknown>
  error?: { kind: 'throw' | 'timeout'; message: string }
  called?: boolean
}

export type ModHookHandler = (
  api: ModsApi,
  event: unknown,
  next: ModNext
) => unknown | Promise<unknown>

export type ModMatcher = Record<string, unknown>

export interface ModRegistration {
  catch: (handler: ModHookHandler) => void
}

export type ModOn = (
  event: string,
  matcherOrHandler: ModMatcher | ModHookHandler,
  maybeHandler?: ModHookHandler
) => ModRegistration

export interface LoadedModInfo {
  id: string
  name: string
  root: string
  tier: ModTier
  enabled: boolean
  source: string
  version?: string
  description?: string
  hooks: string[]
  calls: string[]
  /** First failure seen while loading (import error, missing register, hang). */
  error?: string
}

export interface ModCommandReg {
  name: string
  description: string
  argumentHint?: string
  immediate?: boolean
  plugin: string
}

export interface ModToolReg {
  name: string
  fullName: string
  description: string
  inputSchema: Record<string, unknown>
  plugin: string
  /** Runs when the model calls this tool and no earlier hook answers it. */
  handler?: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

/** Mods API (`$`) — namespaces mirror Claude Code. */
export interface ModsApi {
  plugin: { name: string; root: string }
  ui: {
    invalidate: (event?: string) => void
    status: (text: string) => void
    toast: (text: string, opts?: { timeoutMs?: number }) => void
    log: (text: string) => void
    open: (opts: {
      id: string
      title?: string
      placement?: string
      rows?: number
      tree?: unknown
    }) => void
    close: (id: string) => void
    resolve: (e: unknown) => ModElementTable
    notice: (text: string) => void
  }
  command: {
    register: (opts: { name: string; description: string; argumentHint?: string; immediate?: boolean }) => Promise<void>
    run: (opts: { command: string; args?: string }) => Promise<{ text?: string }>
    list: () => Promise<ModCommandReg[]>
  }
  tool: {
    register: (opts: {
      name: string
      description: string
      inputSchema?: Record<string, unknown>
      handler?: (args: Record<string, unknown>) => unknown | Promise<unknown>
    }) => Promise<void>
    call: (input: { tool: string } & Record<string, unknown>) => Promise<unknown>
    list: () => Promise<ModToolReg[]>
  }
  prompt: {
    submit: (opts: { text: string; asUser?: boolean }) => Promise<void>
  }
  session: {
    id: () => string
    cwd: () => string
    messages: () => Array<{ role: string; text: string }>
    usage: () => { context: { tokens: number; window: number; percent: number } }
  }
  fs: {
    read: (path: string) => Promise<string>
    write: (path: string, text: string) => Promise<void>
    exists: (path: string) => Promise<boolean>
    list: (path: string) => Promise<Array<{ name: string; kind: string; size: number; isLink: boolean }>>
    stat: (path: string) => Promise<{ size: number; isFile: boolean; isDirectory: boolean } | null>
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
    keys: () => Promise<string[]>
  }
  clock: {
    now: () => Promise<number>
    sleep: (ms: number) => Promise<void>
    after: (ms: number, fn: () => void | Promise<void>) => { cancel: () => void }
    every: (ms: number, fn: () => void | Promise<void>) => { cancel: () => void }
  }
  http: {
    fetch: (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ) => Promise<{ status: number; ok: boolean; headers: Record<string, string>; text: string }>
  }
  process: {
    run: (
      argv: string[],
      opts?: { timeoutMs?: number; cwd?: string }
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
  env: {
    get: (name: string) => string | undefined
    set: (name: string, value: string) => void
  }
  model: {
    complete: (opts: {
      model?: string
      system?: string
      prompt: string
      maxTokens?: number
      timeoutMs?: number
    }) => Promise<{ isAnswered: boolean; text?: string; reason?: string }>
  }
  turn: { abort: () => void }
}

export type ModElementCtor = (props: Record<string, unknown>) => unknown

export type ModElementTable = Record<string, ModElementCtor>

export interface UiRenderEvent {
  component: string
  surface: 'desktop' | 'terminal'
  props: Record<string, unknown>
  requestId?: string
  viewport?: { columns: number; rows: number; isFullscreen: boolean }
}
