// Bridges Pawn's own tool-calling pipeline to MCP (Model Context Protocol)
// servers the user has already configured for other tools (Claude Code,
// Cursor, etc.) — see ~/.claude/plans (MCP client support) for the full
// design. The main process owns discovery/spawn/connect (src/main/mcpManager.ts);
// this module is the renderer-side adapter into ToolDefinition/ToolCall/ToolResult.
import type { ToolDefinition, ToolResult } from './toolDefinitions'

const PREFIX = 'mcp__'

export function isMcpToolName(name: string): boolean {
  return name.startsWith(PREFIX)
}

/** `mcp__<serverId>__<toolName>` — safe to split on the first `__` because
 *  server ids are sanitized (no `__`) before this name is ever constructed. */
export function parseMcpToolName(name: string): { serverId: string; toolName: string } | null {
  if (!isMcpToolName(name)) return null
  const rest = name.slice(PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep === -1) return null
  return { serverId: rest.slice(0, sep), toolName: rest.slice(sep + 2) }
}

// Tool schemas are folded into a cached prompt prefix (see toolWire.ts's
// cache_control stamp), so refetching the catalog on every LLM call within a
// turn would keep invalidating that cache. A short-lived cache keeps the
// list byte-stable across a turn's tool-calling rounds while still picking
// up server changes reasonably quickly between turns.
const CACHE_TTL = 60_000
const catalogCache = new Map<string, { at: number; statuses: McpServerStatus[] }>()

// The settings-page "disable this server" toggle lives in stores/mcp.ts, but
// this module intentionally has no dependency on any store (kept plain and
// unit-testable) — the store pushes its current set here instead of this
// module reaching back into the store, which would create an import cycle.
let disabledServerIds = new Set<string>()

export function setDisabledMcpServers(ids: Iterable<string>): void {
  disabledServerIds = new Set(ids)
}

/** Discovered MCP tools, mapped into Pawn's own ToolDefinition shape and
 *  namespaced as `mcp__<serverId>__<toolName>` so they can be dispatched
 *  unambiguously alongside the static built-in tool list. Servers the user
 *  disabled in Settings are filtered out here (fresh every call, not baked
 *  into the cache) so toggling one off takes effect immediately rather than
 *  waiting out the discovery cache's TTL. */
export async function getMcpToolDefinitions(projectPath?: string): Promise<ToolDefinition[]> {
  const key = projectPath || '__none__'
  const hit = catalogCache.get(key)
  const statuses = hit && Date.now() - hit.at < CACHE_TTL
    ? hit.statuses
    : await fetchStatuses(projectPath, key)

  return statuses
    .filter((s): s is { id: string; source: McpServerSource; status: 'connected'; tools: McpToolInfo[] } => s.status === 'connected' && !disabledServerIds.has(s.id))
    .flatMap((s) => s.tools.map((t) => ({
      name: `mcp__${s.id}__${t.name}`,
      description: t.description,
      parameters: t.inputSchema
    })))
}

async function fetchStatuses(projectPath: string | undefined, key: string): Promise<McpServerStatus[]> {
  let statuses: McpServerStatus[] = []
  try {
    statuses = (await window.api.mcp?.listTools?.(projectPath)) || []
  } catch {
    statuses = []
  }
  catalogCache.set(key, { at: Date.now(), statuses })
  return statuses
}

/** Drop every cached catalog so a manual reconnect/refresh (e.g. from the
 *  settings page) is reflected on the very next turn. */
export function clearMcpToolCache(): void {
  catalogCache.clear()
}

export async function callMcpTool(
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
  projectPath?: string
): Promise<ToolResult> {
  const parsed = parseMcpToolName(name)
  if (!parsed) {
    return { toolCallId, content: `Malformed MCP tool name: ${name}`, isError: true }
  }
  if (!window.api.mcp?.callTool) {
    return { toolCallId, content: 'MCP tools are not available in this environment.', isError: true }
  }
  const result = await window.api.mcp.callTool(projectPath, parsed.serverId, parsed.toolName, args)
  return { toolCallId, content: result.content, isError: result.isError }
}
