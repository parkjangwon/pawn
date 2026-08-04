import { handleTrusted } from './trust'
import {
  discoverConfigs, listAllTools, snapshotStatus, callTool, writeServerConfig, removeServerConfig,
  type McpServerConfig, type McpServerInput
} from '../mcpManager'

async function resolveConfigs(projectPath: unknown): Promise<McpServerConfig[]> {
  return discoverConfigs(typeof projectPath === 'string' && projectPath ? projectPath : undefined)
}

function asScope(value: unknown): 'user' | 'project' | null {
  return value === 'user' || value === 'project' ? value : null
}

function asServerInput(value: unknown): McpServerInput | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.command !== 'string') return null
  const args = Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === 'string') : []
  const env = typeof v.env === 'object' && v.env !== null
    ? Object.fromEntries(Object.entries(v.env as Record<string, unknown>).filter(([, val]) => typeof val === 'string')) as Record<string, string>
    : undefined
  return { command: v.command, args, env }
}

export function registerMcpIpc(): void {
  handleTrusted('mcp:listTools', async (_, projectPath) => {
    const configs = await resolveConfigs(projectPath)
    return listAllTools(configs)
  })

  // Cached snapshot only — a settings-page poll should never itself trigger
  // a spawn just because the panel is open.
  handleTrusted('mcp:status', async (_, projectPath) => {
    const configs = await resolveConfigs(projectPath)
    return snapshotStatus(configs)
  })

  handleTrusted('mcp:callTool', async (_, projectPath, serverId, toolName, args) => {
    if (typeof serverId !== 'string' || typeof toolName !== 'string') {
      return { content: 'Invalid MCP tool call', isError: true }
    }
    const configs = await resolveConfigs(typeof projectPath === 'string' ? projectPath : undefined)
    const config = configs.find((c) => c.id === serverId)
    if (!config) return { content: `Unknown MCP server: ${serverId}`, isError: true }
    return callTool(config, toolName, typeof args === 'object' && args !== null ? args : {})
  })

  handleTrusted('mcp:addServer', async (_, scope, projectPath, id, input) => {
    const parsedScope = asScope(scope)
    const parsedInput = asServerInput(input)
    if (!parsedScope || typeof id !== 'string' || !parsedInput) {
      return { ok: false, error: 'Invalid server configuration.' }
    }
    return writeServerConfig(parsedScope, typeof projectPath === 'string' ? projectPath : undefined, id, parsedInput)
  })

  handleTrusted('mcp:removeServer', async (_, scope, projectPath, id) => {
    const parsedScope = asScope(scope)
    if (!parsedScope || typeof id !== 'string') return { ok: false, error: 'Invalid request.' }
    return removeServerConfig(parsedScope, typeof projectPath === 'string' ? projectPath : undefined, id)
  })
}
