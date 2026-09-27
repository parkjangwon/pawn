/**
 * Language-server manager (main process).
 *
 * One client per (language, project root). Clients start lazily on the first
 * request, keep documents in sync (full-text didOpen/didChange), collect
 * publishDiagnostics, and shut down after a period of inactivity.
 */

import { spawn, type ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import { delimiter, resolve } from 'path'
import { pathToFileURL, fileURLToPath } from 'url'
import { JsonRpcConnection } from './jsonrpc'
import {
  findProjectRoot,
  resolveServer,
  specForPath,
  type LspLanguage,
  type ResolvedServer,
  type ServerSpec
} from './servers'

export type Severity = 'error' | 'warning' | 'info' | 'hint'

export interface Diagnostic {
  line: number
  column: number
  endLine?: number
  endColumn?: number
  severity: Severity
  message: string
  source?: string
  code?: string | number
}

export interface Location {
  path: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  preview?: string
}

/** One text replacement, 1-based line / column (UTF-16 columns, like JS strings). */
export interface FileTextEdit {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText: string
}

/** A WorkspaceEdit flattened for the renderer (which applies it with undo). */
export interface NormalizedWorkspaceEdit {
  files: Array<{ path: string; edits: FileTextEdit[] }>
  creates: string[]
  renames: Array<{ from: string; to: string }>
  deletes: string[]
}

export interface SymbolInfo {
  name: string
  kind: string
  path: string
  line: number
  column: number
  endLine?: number
  detail?: string
  container?: string
  depth?: number
}

export interface CodeActionInfo {
  index: number
  title: string
  kind?: string
  isPreferred?: boolean
  hasEdit: boolean
  hasCommand: boolean
  disabled?: string
}

export interface ServerStatus {
  language: string
  server: string
  state: 'starting' | 'ready' | 'error' | 'unavailable' | 'stopped'
  error?: string
}

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

interface RawDiagnostic {
  range: LspRange
  severity?: number
  message: string
  source?: string
  code?: string | number | { value: string | number }
}

const IDLE_SHUTDOWN_MS = 10 * 60_000
const INIT_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_CLIENTS = 8
const MAX_FILE_CHARS = 2_000_000

const SEVERITY: Record<number, Severity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }

const SYMBOL_KINDS = [
  '', 'file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum',
  'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key',
  'null', 'enumMember', 'struct', 'event', 'operator', 'typeParameter'
]

export function symbolKindName(kind: unknown): string {
  return (typeof kind === 'number' && SYMBOL_KINDS[kind]) || 'symbol'
}

function toFileEdit(e: { range: LspRange; newText?: string }): FileTextEdit {
  return {
    startLine: e.range.start.line + 1,
    startColumn: e.range.start.character + 1,
    endLine: e.range.end.line + 1,
    endColumn: e.range.end.character + 1,
    newText: typeof e.newText === 'string' ? e.newText : ''
  }
}

/** WorkspaceEdit (`changes` or `documentChanges`) → flat per-file edit lists. */
export function normalizeWorkspaceEdit(raw: unknown): NormalizedWorkspaceEdit {
  const out: NormalizedWorkspaceEdit = { files: [], creates: [], renames: [], deletes: [] }
  if (!raw || typeof raw !== 'object') return out
  const byPath = new Map<string, FileTextEdit[]>()
  const add = (uri: string, edits: unknown): void => {
    if (!Array.isArray(edits)) return
    const path = fromUri(uri)
    const list = byPath.get(path) || []
    for (const e of edits) {
      if (e && typeof e === 'object' && (e as { range?: unknown }).range) list.push(toFileEdit(e as { range: LspRange; newText?: string }))
    }
    byPath.set(path, list)
  }
  const w = raw as { changes?: Record<string, unknown>; documentChanges?: unknown[] }
  if (Array.isArray(w.documentChanges)) {
    for (const dc of w.documentChanges) {
      if (!dc || typeof dc !== 'object') continue
      const d = dc as Record<string, any>
      if (d.kind === 'create' && typeof d.uri === 'string') out.creates.push(fromUri(d.uri))
      else if (d.kind === 'rename' && typeof d.oldUri === 'string' && typeof d.newUri === 'string') {
        out.renames.push({ from: fromUri(d.oldUri), to: fromUri(d.newUri) })
      } else if (d.kind === 'delete' && typeof d.uri === 'string') out.deletes.push(fromUri(d.uri))
      else if (d.textDocument && typeof d.textDocument.uri === 'string') add(d.textDocument.uri, d.edits)
    }
  } else if (w.changes && typeof w.changes === 'object') {
    for (const [uri, edits] of Object.entries(w.changes)) add(uri, edits)
  }
  out.files = Array.from(byPath.entries())
    .filter(([, edits]) => edits.length > 0)
    .map(([path, edits]) => ({ path, edits }))
  return out
}

function mergeEdits(a: NormalizedWorkspaceEdit, b: NormalizedWorkspaceEdit): NormalizedWorkspaceEdit {
  const byPath = new Map<string, FileTextEdit[]>()
  for (const f of [...a.files, ...b.files]) byPath.set(f.path, [...(byPath.get(f.path) || []), ...f.edits])
  return {
    files: Array.from(byPath.entries()).map(([path, edits]) => ({ path, edits })),
    creates: [...a.creates, ...b.creates],
    renames: [...a.renames, ...b.renames],
    deletes: [...a.deletes, ...b.deletes]
  }
}

/** DocumentSymbol[] (hierarchical) | SymbolInformation[] → flat list. */
export function flattenSymbols(raw: unknown, path: string, max = 400): SymbolInfo[] {
  const out: SymbolInfo[] = []
  if (!Array.isArray(raw)) return out
  const walk = (items: unknown[], depth: number, container?: string): void => {
    for (const it of items) {
      if (out.length >= max || !it || typeof it !== 'object') return
      const r = it as Record<string, any>
      if (r.location && typeof r.location.uri === 'string') {
        out.push({
          name: String(r.name || ''),
          kind: symbolKindName(r.kind),
          path: fromUri(r.location.uri),
          line: (r.location.range?.start?.line ?? 0) + 1,
          column: (r.location.range?.start?.character ?? 0) + 1,
          ...(r.containerName ? { container: String(r.containerName) } : {})
        })
        continue
      }
      const range = r.selectionRange || r.range
      out.push({
        name: String(r.name || ''),
        kind: symbolKindName(r.kind),
        path,
        line: (range?.start?.line ?? 0) + 1,
        column: (range?.start?.character ?? 0) + 1,
        ...(r.range?.end ? { endLine: r.range.end.line + 1 } : {}),
        ...(r.detail ? { detail: String(r.detail).slice(0, 160) } : {}),
        ...(container ? { container } : {}),
        depth
      })
      if (Array.isArray(r.children)) walk(r.children, depth + 1, String(r.name || ''))
    }
  }
  walk(raw, 0)
  return out
}

export function toUri(path: string): string {
  return pathToFileURL(resolve(path)).href
}

export function fromUri(uri: string): string {
  try {
    return fileURLToPath(uri)
  } catch {
    return uri
  }
}

export function convertDiagnostic(d: RawDiagnostic): Diagnostic {
  const code = typeof d.code === 'object' && d.code !== null ? d.code.value : d.code
  return {
    line: d.range.start.line + 1,
    column: d.range.start.character + 1,
    endLine: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    severity: SEVERITY[d.severity ?? 1] ?? 'error',
    message: String(d.message || '').trim(),
    ...(d.source ? { source: d.source } : {}),
    ...(code !== undefined ? { code } : {})
  }
}

/** Location | Location[] | LocationLink[] | null → flat list. */
export function normalizeLocations(result: unknown): Array<{ uri: string; range: LspRange }> {
  if (!result) return []
  const list = Array.isArray(result) ? result : [result]
  const out: Array<{ uri: string; range: LspRange }> = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, any>
    if (typeof r.uri === 'string' && r.range) out.push({ uri: r.uri, range: r.range })
    else if (typeof r.targetUri === 'string') out.push({ uri: r.targetUri, range: r.targetSelectionRange || r.targetRange })
  }
  return out
}

export function hoverText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const contents = (result as { contents?: unknown }).contents
  const one = (c: unknown): string => {
    if (typeof c === 'string') return c
    if (c && typeof c === 'object') {
      const v = (c as { value?: unknown }).value
      if (typeof v === 'string') {
        const lang = (c as { language?: unknown }).language
        return typeof lang === 'string' ? `\`\`\`${lang}\n${v}\n\`\`\`` : v
      }
    }
    return ''
  }
  return (Array.isArray(contents) ? contents.map(one) : [one(contents)]).filter(Boolean).join('\n\n').trim()
}

function readText(path: string): string | null {
  try {
    const t = readFileSync(path, 'utf8')
    return t.length > MAX_FILE_CHARS ? null : t
  } catch {
    return null
  }
}

interface DiagState {
  diagnostics: Diagnostic[]
  receivedAt: number
}

export interface SpawnFn {
  (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess
}

const defaultSpawn: SpawnFn = (command, args, opts) =>
  spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

export class LspClient {
  readonly key: string
  state: ServerStatus['state'] = 'starting'
  error?: string
  lastUsed = Date.now()
  private conn: JsonRpcConnection | null = null
  private proc: ChildProcess | null = null
  private ready: Promise<void> | null = null
  private docs = new Map<string, { version: number; text: string }>()
  private diags = new Map<string, DiagState>()
  private rawDiags = new Map<string, RawDiagnostic[]>()
  /** Edits the server pushed via workspace/applyEdit while a command ran. */
  private captured: NormalizedWorkspaceEdit[] | null = null
  /** Last code-action list per file (applied by index). */
  lastActions = new Map<string, unknown[]>()
  private waiters = new Map<string, Array<() => void>>()
  private stderrTail = ''

  constructor(
    readonly spec: ServerSpec,
    readonly root: string,
    private readonly resolved: ResolvedServer,
    private readonly spawnFn: SpawnFn = defaultSpawn
  ) {
    this.key = `${spec.language}:${root}`
  }

  start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = this.doStart().catch((err: unknown) => {
      this.state = 'error'
      this.error = `${err instanceof Error ? err.message : String(err)}${this.stderrTail ? ` — ${this.stderrTail.slice(-300)}` : ''}`
      this.dispose()
      throw err
    })
    return this.ready
  }

  private async doStart(): Promise<void> {
    const command = this.resolved.command
    if (!command) throw new Error(this.resolved.unavailable || 'server not found')
    const env = { ...process.env, PATH: [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(delimiter) }
    const proc = this.spawnFn(command, this.spec.args, { cwd: this.root, env })
    this.proc = proc
    proc.stderr?.on('data', (c: Buffer) => {
      this.stderrTail = (this.stderrTail + c.toString('utf8')).slice(-2000)
    })
    const conn = new JsonRpcConnection(proc)
    this.conn = conn
    conn.onNotification = (method, params) => this.onNotification(method, params)
    conn.onRequest = (method, params) => {
      if (method === 'workspace/configuration') {
        const items = (params as { items?: unknown[] })?.items
        return Array.isArray(items) ? items.map(() => null) : []
      }
      if (method === 'workspace/workspaceFolders') return [{ uri: toUri(this.root), name: 'root' }]
      if (method === 'workspace/applyEdit') {
        const edit = normalizeWorkspaceEdit((params as { edit?: unknown })?.edit)
        if (this.captured) {
          this.captured.push(edit)
          return { applied: true }
        }
        return { applied: false, failureReason: 'Pawn applies edits itself; run the code action through lsp_code_actions.' }
      }
      if (method === 'window/workDoneProgress/create' || method === 'client/registerCapability') return null
      return null
    }
    conn.onClose = (reason) => {
      if (this.state !== 'stopped') {
        this.state = 'error'
        this.error = `server ${reason}${this.stderrTail ? ` — ${this.stderrTail.slice(-300)}` : ''}`
      }
      this.releaseWaiters()
    }
    const rootUri = toUri(this.root)
    await conn.request(
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'pawn' },
        rootUri,
        rootPath: this.root,
        workspaceFolders: [{ uri: rootUri, name: 'root' }],
        initializationOptions: this.resolved.initializationOptions ?? {},
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          textDocument: {
            synchronization: { didSave: true, dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false, versionSupport: true },
            definition: { linkSupport: true },
            references: {},
            hover: { contentFormat: ['markdown', 'plaintext'] },
            rename: { prepareSupport: false },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            callHierarchy: {},
            codeAction: {
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports', 'source.fixAll']
                }
              },
              resolveSupport: { properties: ['edit'] },
              dataSupport: true,
              isPreferredSupport: true,
              disabledSupport: true
            }
          },
          workspace: {
            configuration: true,
            workspaceFolders: true,
            applyEdit: true,
            workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] },
            symbol: {},
            executeCommand: {}
          }
        }
      },
      INIT_TIMEOUT_MS
    )
    conn.notify('initialized', {})
    this.state = 'ready'
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== 'textDocument/publishDiagnostics') return
    const p = params as { uri?: string; diagnostics?: RawDiagnostic[] }
    if (!p?.uri) return
    const uri = normalizeUri(p.uri)
    this.rawDiags.set(uri, p.diagnostics || [])
    this.diags.set(uri, {
      diagnostics: (p.diagnostics || []).map(convertDiagnostic),
      receivedAt: Date.now()
    })
    const ws = this.waiters.get(uri)
    if (ws) {
      this.waiters.delete(uri)
      for (const w of ws) w()
    }
  }

  private releaseWaiters(): void {
    for (const ws of Array.from(this.waiters.values())) for (const w of ws) w()
    this.waiters.clear()
  }

  /** Open or update a document. Returns the sync timestamp. */
  sync(path: string, content?: string): number {
    const conn = this.conn
    if (!conn || this.state !== 'ready') return 0
    const text = content ?? readText(path)
    if (text === null) return 0
    const uri = normalizeUri(toUri(path))
    const doc = this.docs.get(uri)
    const now = Date.now()
    if (!doc) {
      this.docs.set(uri, { version: 1, text })
      conn.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: this.spec.languageId(extOf(path)), version: 1, text }
      })
      return now
    }
    if (doc.text === text) return 0
    doc.version++
    doc.text = text
    conn.notify('textDocument/didChange', {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text }]
    })
    conn.notify('textDocument/didSave', { textDocument: { uri } })
    return now
  }

  async diagnostics(path: string, opts: { content?: string; waitMs: number }): Promise<{ diagnostics: Diagnostic[]; fresh: boolean }> {
    this.lastUsed = Date.now()
    const uri = normalizeUri(toUri(path))
    const syncedAt = this.sync(path, opts.content)
    const current = this.diags.get(uri)
    const needFresh = syncedAt > 0 || !current
    if (needFresh && opts.waitMs > 0) {
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(done, opts.waitMs)
        function done(): void {
          clearTimeout(timer)
          resolveWait()
        }
        const list = this.waiters.get(uri) || []
        list.push(done)
        this.waiters.set(uri, list)
      })
      // Servers often publish an empty set first, then the real result.
      const first = this.diags.get(uri)
      if (first && first.receivedAt >= syncedAt && first.diagnostics.length === 0 && opts.waitMs > 400) {
        await new Promise<void>((r) => {
          const t = setTimeout(r, 350)
          const list = this.waiters.get(uri) || []
          list.push(() => {
            clearTimeout(t)
            r()
          })
          this.waiters.set(uri, list)
        })
      }
    }
    const state = this.diags.get(uri)
    return { diagnostics: state?.diagnostics ?? [], fresh: !!state && state.receivedAt >= syncedAt }
  }

  async request(method: string, path: string, line: number, character: number, extra: Record<string, unknown> = {}): Promise<unknown> {
    this.lastUsed = Date.now()
    this.sync(path)
    if (!this.conn) throw new Error('server not running')
    return this.conn.request(
      method,
      { textDocument: { uri: toUri(path) }, position: { line: Math.max(0, line - 1), character: Math.max(0, character - 1) }, ...extra },
      REQUEST_TIMEOUT_MS
    )
  }

  /** Generic request with a document already synced from disk. */
  async call(method: string, params: unknown, path?: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    this.lastUsed = Date.now()
    if (path) this.sync(path)
    if (!this.conn) throw new Error('server not running')
    return this.conn.request(method, params, timeoutMs)
  }

  /** Raw diagnostics overlapping a line range (context for code actions). */
  diagnosticsInRange(path: string, startLine: number, endLine: number): RawDiagnostic[] {
    const list = this.rawDiags.get(normalizeUri(toUri(path))) || []
    return list.filter((d) => d.range.start.line <= endLine - 1 && d.range.end.line >= startLine - 1)
  }

  /** Run `fn` while collecting workspace/applyEdit pushes from the server. */
  async capturingEdits(fn: () => Promise<unknown>): Promise<NormalizedWorkspaceEdit[]> {
    this.captured = []
    try {
      await fn()
      // Servers often push the edit right after answering executeCommand.
      await new Promise((r) => setTimeout(r, 150))
      return this.captured
    } finally {
      this.captured = null
    }
  }

  status(): ServerStatus {
    return {
      language: this.spec.language,
      server: this.resolved.command || this.spec.commands[0],
      state: this.state,
      ...(this.error ? { error: this.error } : {})
    }
  }

  async shutdown(): Promise<void> {
    const conn = this.conn
    this.state = 'stopped'
    if (conn && !conn.isClosed) {
      try {
        await conn.request('shutdown', null, 2000)
        conn.notify('exit', null)
      } catch {
        /* force below */
      }
    }
    this.dispose()
  }

  dispose(): void {
    this.releaseWaiters()
    this.conn?.close('disposed')
    this.conn = null
    if (this.proc && this.proc.exitCode === null) {
      try {
        this.proc.kill()
      } catch {
        /* already gone */
      }
    }
    this.proc = null
  }
}

function extOf(path: string): string {
  const m = /\.[^./\\]+$/.exec(path)
  return m ? m[0].toLowerCase() : ''
}

/** Servers percent-encode differently (e.g. `%3A` on Windows drives); compare decoded. */
function normalizeUri(uri: string): string {
  try {
    return toUri(fileURLToPath(uri))
  } catch {
    return uri
  }
}

export class LspManager {
  private clients = new Map<string, LspClient>()
  private unavailable = new Map<string, string>()
  private idleTimer: ReturnType<typeof setInterval> | null = null
  enabled = true

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly resolve: typeof resolveServer = resolveServer
  ) {}

  setEnabled(v: boolean): void {
    this.enabled = v
    if (!v) void this.disposeAll()
  }

  /** Client for a file, started on demand. Null when unsupported/unavailable. */
  async clientFor(path: string, workspaceRoot: string): Promise<{ client: LspClient | null; reason?: string }> {
    if (!this.enabled) return { client: null, reason: 'Language servers are disabled in Settings → Agent.' }
    const spec = specForPath(path)
    if (!spec) return { client: null, reason: 'unsupported' }
    const root = findProjectRoot(path, spec.rootMarkers, workspaceRoot)
    const key = `${spec.language}:${root}`
    const known = this.unavailable.get(key)
    if (known) return { client: null, reason: known }
    let client = this.clients.get(key)
    if (!client || client.state === 'error' || client.state === 'stopped') {
      const resolved = this.resolve(spec, workspaceRoot)
      if (resolved.unavailable) {
        this.unavailable.set(key, resolved.unavailable)
        return { client: null, reason: resolved.unavailable }
      }
      client?.dispose()
      if (this.clients.size >= MAX_CLIENTS) this.evictOldest()
      client = new LspClient(spec, root, resolved, this.spawnFn)
      this.clients.set(key, client)
      this.ensureIdleTimer()
    }
    try {
      await client.start()
    } catch (err) {
      return { client: null, reason: client.error || (err instanceof Error ? err.message : String(err)) }
    }
    return { client }
  }

  async diagnostics(
    root: string,
    paths: string[],
    opts: { waitMs?: number; content?: Record<string, string> } = {}
  ): Promise<{ files: Array<{ path: string; diagnostics: Diagnostic[]; fresh?: boolean }>; unsupported: string[]; errors: string[] }> {
    const waitMs = Math.min(10_000, Math.max(0, opts.waitMs ?? 2500))
    const files: Array<{ path: string; diagnostics: Diagnostic[]; fresh?: boolean }> = []
    const unsupported: string[] = []
    const errors = new Set<string>()
    await Promise.all(
      paths.slice(0, 20).map(async (p) => {
        const abs = resolve(root, p)
        const { client, reason } = await this.clientFor(abs, root)
        if (!client) {
          if (reason === 'unsupported') unsupported.push(abs)
          else if (reason) errors.add(reason)
          return
        }
        const r = await client.diagnostics(abs, { content: opts.content?.[p] ?? opts.content?.[abs], waitMs })
        files.push({ path: abs, diagnostics: r.diagnostics, fresh: r.fresh })
      })
    )
    return { files, unsupported, errors: Array.from(errors) }
  }

  async locations(
    method: 'textDocument/definition' | 'textDocument/references',
    root: string,
    path: string,
    line: number,
    column: number
  ): Promise<{ locations: Location[]; error?: string }> {
    const abs = resolve(root, path)
    const { client, reason } = await this.clientFor(abs, root)
    if (!client) return { locations: [], error: reason === 'unsupported' ? 'No language server for this file type.' : reason }
    const extra = method === 'textDocument/references' ? { context: { includeDeclaration: true } } : {}
    const raw = await client.request(method, abs, line, column, extra)
    const cache = new Map<string, string[] | null>()
    const locations = normalizeLocations(raw)
      .slice(0, 200)
      .map((l) => {
        const file = fromUri(l.uri)
        if (!cache.has(file)) cache.set(file, readText(file)?.split('\n') ?? null)
        const lines = cache.get(file)
        return {
          path: file,
          line: l.range.start.line + 1,
          column: l.range.start.character + 1,
          endLine: l.range.end.line + 1,
          endColumn: l.range.end.character + 1,
          ...(lines?.[l.range.start.line] !== undefined ? { preview: lines[l.range.start.line].trim().slice(0, 200) } : {})
        }
      })
    return { locations }
  }

  async hover(root: string, path: string, line: number, column: number): Promise<{ text?: string; error?: string }> {
    const abs = resolve(root, path)
    const { client, reason } = await this.clientFor(abs, root)
    if (!client) return { error: reason === 'unsupported' ? 'No language server for this file type.' : reason }
    const raw = await client.request('textDocument/hover', abs, line, column)
    return { text: hoverText(raw) }
  }

  private async requireClient(root: string, path: string): Promise<{ client: LspClient; abs: string } | { error: string }> {
    const abs = resolve(root, path)
    const { client, reason } = await this.clientFor(abs, root)
    if (!client) return { error: reason === 'unsupported' ? 'No language server for this file type.' : reason || 'server unavailable' }
    return { client, abs }
  }

  async rename(root: string, path: string, line: number, column: number, newName: string): Promise<{ edit?: NormalizedWorkspaceEdit; error?: string }> {
    const c = await this.requireClient(root, path)
    if ('error' in c) return { error: c.error }
    const raw = await c.client.request('textDocument/rename', c.abs, line, column, { newName })
    if (!raw) return { error: 'The symbol at this position cannot be renamed.' }
    return { edit: normalizeWorkspaceEdit(raw) }
  }

  async documentSymbols(root: string, path: string): Promise<{ symbols: SymbolInfo[]; error?: string }> {
    const c = await this.requireClient(root, path)
    if ('error' in c) return { symbols: [], error: c.error }
    const raw = await c.client.call('textDocument/documentSymbol', { textDocument: { uri: toUri(c.abs) } }, c.abs)
    return { symbols: flattenSymbols(raw, c.abs) }
  }

  async workspaceSymbols(root: string, query: string, hintPath?: string): Promise<{ symbols: SymbolInfo[]; error?: string }> {
    // A workspace query needs a running server for the language; use the
    // hint file (or any source file the user named) to pick one.
    const probe = hintPath ? resolve(root, hintPath) : null
    if (!probe) return { symbols: [], error: 'Pass path (any file of the language to search) for workspace symbols.' }
    const c = await this.requireClient(root, probe)
    if ('error' in c) return { symbols: [], error: c.error }
    const raw = await c.client.call('workspace/symbol', { query }, c.abs)
    return { symbols: flattenSymbols(raw, c.abs, 200) }
  }

  async callHierarchy(
    root: string,
    path: string,
    line: number,
    column: number,
    direction: 'incoming' | 'outgoing'
  ): Promise<{ item?: SymbolInfo; calls: Array<SymbolInfo & { callLines: number[] }>; error?: string }> {
    const c = await this.requireClient(root, path)
    if ('error' in c) return { calls: [], error: c.error }
    const items = (await c.client.request('textDocument/prepareCallHierarchy', c.abs, line, column)) as Array<Record<string, any>> | null
    if (!Array.isArray(items) || !items.length) return { calls: [], error: 'No callable symbol at this position.' }
    const item = items[0]
    const method = direction === 'incoming' ? 'callHierarchy/incomingCalls' : 'callHierarchy/outgoingCalls'
    const raw = (await c.client.call(method, { item })) as Array<Record<string, any>> | null
    const toInfo = (it: Record<string, any>): SymbolInfo => ({
      name: String(it.name || ''),
      kind: symbolKindName(it.kind),
      path: fromUri(String(it.uri || '')),
      line: (it.selectionRange?.start?.line ?? it.range?.start?.line ?? 0) + 1,
      column: (it.selectionRange?.start?.character ?? 0) + 1,
      ...(it.detail ? { detail: String(it.detail).slice(0, 160) } : {})
    })
    const calls = (Array.isArray(raw) ? raw : []).slice(0, 100).map((call) => {
      const other = direction === 'incoming' ? call.from : call.to
      return {
        ...toInfo(other || {}),
        callLines: (Array.isArray(call.fromRanges) ? call.fromRanges : []).map((r: LspRange) => r.start.line + 1).slice(0, 10)
      }
    })
    return { item: toInfo(item), calls }
  }

  async codeActions(
    root: string,
    path: string,
    range: { startLine: number; startColumn: number; endLine: number; endColumn: number },
    only?: string[]
  ): Promise<{ actions: CodeActionInfo[]; error?: string }> {
    const c = await this.requireClient(root, path)
    if ('error' in c) return { actions: [], error: c.error }
    c.client.sync(c.abs)
    // Quick fixes need the diagnostics for the range; let them arrive first.
    await c.client.diagnostics(c.abs, { waitMs: 1500 })
    const lspRange = {
      start: { line: range.startLine - 1, character: range.startColumn - 1 },
      end: { line: range.endLine - 1, character: range.endColumn - 1 }
    }
    const raw = (await c.client.call('textDocument/codeAction', {
      textDocument: { uri: toUri(c.abs) },
      range: lspRange,
      context: {
        diagnostics: c.client.diagnosticsInRange(c.abs, range.startLine, range.endLine),
        ...(only?.length ? { only } : {}),
        triggerKind: 1
      }
    })) as unknown[] | null
    const list = Array.isArray(raw) ? raw.slice(0, 60) : []
    c.client.lastActions.set(c.abs, list)
    return {
      actions: list
        .map((a, index) => {
        const r = (a || {}) as Record<string, any>
        // A bare Command has `command` as a string; a CodeAction has an object.
        const isCommand = typeof r.command === 'string'
        return {
          index,
          title: String(r.title || ''),
          ...(r.kind ? { kind: String(r.kind) } : {}),
          ...(r.isPreferred ? { isPreferred: true } : {}),
          hasEdit: !!r.edit,
          hasCommand: isCommand || !!r.command,
          ...(r.disabled?.reason ? { disabled: String(r.disabled.reason) } : {})
        }
      })
        // Disabled refactorings ("Selection is not …") are noise for the agent.
        .filter((a) => !a.disabled)
    }
  }

  async applyCodeAction(root: string, path: string, index: number): Promise<{ edit?: NormalizedWorkspaceEdit; title?: string; error?: string }> {
    const c = await this.requireClient(root, path)
    if ('error' in c) return { error: c.error }
    const list = c.client.lastActions.get(c.abs)
    const action = list?.[index] as Record<string, any> | undefined
    if (!action) return { error: 'Unknown code action index. List them first with lsp_code_actions (action "list").' }
    let resolved = action
    if (!action.edit && typeof action.command !== 'string' && action.data !== undefined) {
      try {
        resolved = ((await c.client.call('codeAction/resolve', action)) as Record<string, any>) || action
      } catch {
        /* resolve optional */
      }
    }
    let edit = resolved.edit ? normalizeWorkspaceEdit(resolved.edit) : { files: [], creates: [], renames: [], deletes: [] }
    const command = typeof resolved.command === 'string' ? resolved : resolved.command
    // A code action with an edit usually carries only a bookkeeping command
    // (telemetry / "apply the same fix"); running it would push the edit again.
    if (command && typeof command.command === 'string' && !resolved.edit) {
      const pushed = await c.client.capturingEdits(() =>
        c.client.call('workspace/executeCommand', { command: command.command, arguments: command.arguments || [] })
      )
      for (const p of pushed) edit = mergeEdits(edit, p)
    }
    c.client.lastActions.delete(c.abs)
    return { edit, title: String(action.title || '') }
  }

  status(root?: string): ServerStatus[] {
    const out: ServerStatus[] = []
    for (const c of Array.from(this.clients.values())) {
      if (!root || c.root.startsWith(resolve(root))) out.push({ ...c.status(), server: `${c.status().server} (${c.root})` })
    }
    for (const [key, reason] of Array.from(this.unavailable)) {
      const [language, r] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
      if (!root || r.startsWith(resolve(root))) {
        out.push({ language: language as LspLanguage, server: r, state: 'unavailable', error: reason })
      }
    }
    return out
  }

  private evictOldest(): void {
    let oldest: LspClient | null = null
    for (const c of Array.from(this.clients.values())) if (!oldest || c.lastUsed < oldest.lastUsed) oldest = c
    if (oldest) {
      this.clients.delete(oldest.key)
      void oldest.shutdown()
    }
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => {
      const now = Date.now()
      for (const c of Array.from(this.clients.values())) {
        if (now - c.lastUsed > IDLE_SHUTDOWN_MS) {
          this.clients.delete(c.key)
          void c.shutdown()
        }
      }
      if (this.clients.size === 0 && this.idleTimer) {
        clearInterval(this.idleTimer)
        this.idleTimer = null
      }
    }, 60_000)
    this.idleTimer.unref?.()
  }

  /** Forget "not installed" results (after the user installs a server). */
  clearUnavailable(): void {
    this.unavailable.clear()
  }

  async disposeAll(): Promise<void> {
    const all = Array.from(this.clients.values())
    this.clients.clear()
    this.unavailable.clear()
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    await Promise.all(all.map((c) => c.shutdown().catch(() => c.dispose())))
  }
}

let shared: LspManager | null = null
export function getLspManager(): LspManager {
  if (!shared) shared = new LspManager()
  return shared
}
