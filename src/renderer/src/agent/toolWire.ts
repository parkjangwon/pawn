import { TOOLS, type ToolDefinition } from './toolDefinitions'
import { filterToolsForAgentMode, type AgentMode } from './agentMode'
import { useProviderStore } from '../stores/provider'

export type ToolListOpts = {
  mode?: AgentMode
  allowlist?: string[]
  denylist?: string[]
}

function activeToolList(extra: ToolDefinition[] = [], opts?: ToolListOpts | AgentMode): ToolDefinition[] {
  const normalized: ToolListOpts =
    typeof opts === 'string' || opts == null
      ? { mode: opts as AgentMode | undefined }
      : opts
  const agentMode = normalized.mode ?? useProviderStore.getState().agentMode
  const sortedExtra = [...extra].sort((a, b) => a.name.localeCompare(b.name))
  let list = filterToolsForAgentMode([...TOOLS, ...sortedExtra], agentMode)
  if (normalized.allowlist?.length) {
    const allow = new Set(normalized.allowlist)
    list = list.filter((t) => allow.has(t.name))
  }
  if (normalized.denylist?.length) {
    const deny = new Set(normalized.denylist)
    list = list.filter((t) => !deny.has(t.name))
  }
  return list
}

// Convert tools to OpenAI format. `extra` carries dynamically-discovered
// tools (currently just MCP servers) that aren't part of the static TOOLS list.
export function toolsToOpenAI(
  extra: ToolDefinition[] = [],
  modeOrOpts?: AgentMode | ToolListOpts
): Array<Record<string, unknown>> {
  return activeToolList(extra, modeOrOpts).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

// Convert tools to Claude format
export function toolsToClaude(
  extra: ToolDefinition[] = [],
  modeOrOpts?: AgentMode | ToolListOpts
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = activeToolList(extra, modeOrOpts).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }))
  // Plan mode shrinks the list (cache key changes by mode — acceptable).
  // In Build mode the block is still a large stable prefix.
  if (tools.length > 0) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } }
  }
  return tools
}
