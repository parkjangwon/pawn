import { homedir } from 'os'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { getPawnDir } from './config'

/** Where a server's config came from — controls whether Settings offers a
 *  delete button. `user-claude` is read-only (we never write Claude Code's
 *  own file); the other two are files Pawn itself owns and can edit. */
export type McpServerSource = 'user-claude' | 'user-pawn' | 'project'

/** A normalized, stdio-only MCP server entry ready to spawn. HTTP/SSE remote
 *  servers (OAuth connectors) are out of scope — see the MCP plan doc. */
export interface McpServerConfig {
  id: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  source: McpServerSource
}

export interface McpToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpServerStatus =
  | { id: string; source: McpServerSource; status: 'connecting' }
  | { id: string; source: McpServerSource; status: 'connected'; tools: McpToolInfo[] }
  | { id: string; source: McpServerSource; status: 'error'; error: string }

/** Pawn's own global server registry — separate from `~/.claude.json`, which
 *  is Claude Code's file and never written by this app. */
function userPawnConfigPath(): string {
  return join(getPawnDir(), 'mcp.json')
}

function projectConfigPath(projectPath: string): string {
  return join(projectPath, '.mcp.json')
}

interface ServerEntry {
  client: Client
  transport: StdioClientTransport
  tools: McpToolInfo[]
}

const entries = new Map<string, ServerEntry>()
const errors = new Map<string, string>()
const inFlight = new Map<string, Promise<McpServerStatus>>()

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Server ids double as the middle segment of `mcp__<id>__<tool>` tool names
 *  on the renderer side, so a stray `__` in a config key would make that
 *  split ambiguous — collapse it defensively. */
function sanitizeId(id: string): string {
  return id.replace(/__+/g, '_')
}

function normalizeEntry(id: string, raw: unknown, source: McpServerSource, cwd?: string): McpServerConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  // Only local, unauthenticated stdio servers are supported — remote
  // http/sse connectors are explicitly out of scope for this integration.
  if (typeof r.type === 'string' && r.type !== 'stdio') return null
  if (typeof r.command !== 'string' || !r.command) return null
  const args = Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === 'string') : []
  const env = typeof r.env === 'object' && r.env !== null
    ? Object.fromEntries(Object.entries(r.env as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    : undefined
  return { id: sanitizeId(id), command: r.command, args, env, cwd, source }
}

function entriesOf(raw: Record<string, unknown> | null, source: McpServerSource, cwd: string | undefined, byId: Map<string, McpServerConfig>): void {
  const servers = raw?.mcpServers
  if (typeof servers !== 'object' || servers === null) return
  for (const [id, entry] of Object.entries(servers as Record<string, unknown>)) {
    const cfg = normalizeEntry(id, entry, source, cwd)
    if (cfg) byId.set(cfg.id, cfg)
  }
}

/** Three layers, later wins on id collision: Claude Code's own file (read
 *  only, never written by Pawn) → Pawn's own global registry → the active
 *  project's `.mcp.json`. This lets a project override a same-named global
 *  server, and lets a server the user adds through Pawn's own UI override a
 *  same-named one that happened to already exist in `~/.claude.json`. */
export async function discoverConfigs(projectPath?: string): Promise<McpServerConfig[]> {
  const byId = new Map<string, McpServerConfig>()

  entriesOf(await readJson(join(homedir(), '.claude.json')), 'user-claude', undefined, byId)
  entriesOf(await readJson(userPawnConfigPath()), 'user-pawn', undefined, byId)
  if (projectPath) {
    entriesOf(await readJson(projectConfigPath(projectPath)), 'project', projectPath, byId)
  }

  return Array.from(byId.values())
}

/** Cache key: a project-scoped server (e.g. a code index) must not be shared
 *  across two projects that each expect it to reflect their own cwd. */
function serverKey(config: McpServerConfig): string {
  return `${config.id}:${config.cwd || ''}`
}

async function connect(config: McpServerConfig, key: string): Promise<McpServerStatus> {
  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      // Full env inheritance matches this app's existing shell_exec/terminal
      // behavior (see src/main/ipc/terminal.ts) rather than the SDK's more
      // conservative default allowlist — these are servers the user already
      // configured themselves, not untrusted input.
      env: { ...process.env, ...config.env } as Record<string, string>,
      cwd: config.cwd
    })
    const client = new Client({ name: 'pawn', version: '1.0.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    const toolInfos: McpToolInfo[] = tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema as Record<string, unknown>
    }))
    entries.set(key, { client, transport, tools: toolInfos })
    errors.delete(key)
    return { id: config.id, source: config.source, status: 'connected', tools: toolInfos }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.set(key, message)
    return { id: config.id, source: config.source, status: 'error', error: message }
  }
}

/** Connect (or reuse an existing connection) and return its status. Failed
 *  connections are not retried automatically — the caller has to ask again. */
export async function ensureServer(config: McpServerConfig): Promise<McpServerStatus> {
  const key = serverKey(config)
  const existing = entries.get(key)
  if (existing) return { id: config.id, source: config.source, status: 'connected', tools: existing.tools }

  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = connect(config, key).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

/** Ensure every discovered server is connected and return their statuses —
 *  used both to build the LLM's tool list and to populate the settings UI. */
export async function listAllTools(configs: McpServerConfig[]): Promise<McpServerStatus[]> {
  return Promise.all(configs.map((c) => ensureServer(c)))
}

/** Cached snapshot only — never spawns anything. For a settings-page poll
 *  that shouldn't trigger new connections just by being open. */
export function snapshotStatus(configs: McpServerConfig[]): McpServerStatus[] {
  return configs.map((config) => {
    const key = serverKey(config)
    const entry = entries.get(key)
    if (entry) return { id: config.id, source: config.source, status: 'connected', tools: entry.tools }
    if (inFlight.has(key)) return { id: config.id, source: config.source, status: 'connecting' }
    const error = errors.get(key)
    if (error) return { id: config.id, source: config.source, status: 'error', error }
    return { id: config.id, source: config.source, status: 'connecting' }
  })
}

export async function callTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ content: string; isError?: boolean }> {
  const key = serverKey(config)
  if (!entries.has(key)) await ensureServer(config)
  const entry = entries.get(key)
  if (!entry) {
    return { content: `MCP server "${config.id}" is not connected (${errors.get(key) || 'unknown error'})`, isError: true }
  }
  try {
    const result = await entry.client.callTool({ name: toolName, arguments: args })
    const blocks = Array.isArray(result.content) ? result.content : []
    const text = blocks
      .map((b) => (b.type === 'text' ? b.text : `[${b.type} content omitted]`))
      .join('\n')
    return { content: text || '(no output)', isError: result.isError === true }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true }
  }
}

function disconnect(key: string): void {
  const entry = entries.get(key)
  if (entry) {
    try { void entry.client.close() } catch { /* best-effort teardown */ }
    entries.delete(key)
  }
  errors.delete(key)
  inFlight.delete(key)
}

/** Close every live server connection (kills the spawned child process).
 *  Called on app quit only — unlike terminals, MCP servers are a shared
 *  background capability that a headless routine run may also depend on,
 *  so they must survive the main window closing. */
export function killAllMcpServers(): void {
  Array.from(entries.keys()).forEach(disconnect)
}

async function readMcpServersFile(path: string): Promise<Record<string, unknown>> {
  const raw = await readJson(path)
  const servers = raw?.mcpServers
  return { ...raw, mcpServers: typeof servers === 'object' && servers !== null ? servers : {} }
}

async function writeMcpServersFile(path: string, contents: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(contents, null, 2) + '\n', 'utf-8')
}

export interface McpServerInput {
  command: string
  args: string[]
  env?: Record<string, string>
}

/** Registers a new server (or overwrites an existing one with the same id)
 *  in a file Pawn itself owns — the user's global registry (`~/.pawn/mcp.json`)
 *  or the active project's `.mcp.json`. `~/.claude.json` is never touched. */
export async function writeServerConfig(
  scope: 'user' | 'project',
  projectPath: string | undefined,
  id: string,
  input: McpServerInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (scope === 'project' && !projectPath) return { ok: false, error: 'No active project to add a project-scoped server to.' }
  const safeId = sanitizeId(id.trim())
  if (!safeId) return { ok: false, error: 'Server id is required.' }
  if (!input.command.trim()) return { ok: false, error: 'Command is required.' }

  const path = scope === 'user' ? userPawnConfigPath() : projectConfigPath(projectPath!)
  const file = await readMcpServersFile(path)
  const servers = file.mcpServers as Record<string, unknown>
  servers[safeId] = { command: input.command.trim(), args: input.args, ...(input.env && Object.keys(input.env).length ? { env: input.env } : {}) }
  await writeMcpServersFile(path, file)

  // A previous connection under this id may now be stale (command/args/env
  // changed) — drop it so the next use reconnects with the new config.
  disconnect(`${safeId}:${scope === 'project' ? projectPath : ''}`)
  return { ok: true }
}

/** Removes a server from whichever file Pawn owns for that scope. A server
 *  discovered from `~/.claude.json` (source `user-claude`) cannot be removed
 *  this way — the caller is expected to have already filtered those out. */
export async function removeServerConfig(
  scope: 'user' | 'project',
  projectPath: string | undefined,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (scope === 'project' && !projectPath) return { ok: false, error: 'No active project.' }
  const path = scope === 'user' ? userPawnConfigPath() : projectConfigPath(projectPath!)
  const file = await readMcpServersFile(path)
  const servers = file.mcpServers as Record<string, unknown>
  delete servers[id]
  await writeMcpServersFile(path, file)
  disconnect(`${id}:${scope === 'project' ? projectPath : ''}`)
  return { ok: true }
}
