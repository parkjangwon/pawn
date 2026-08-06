import { TOOLS, type ToolDefinition } from './toolDefinitions'
import { filterToolsForAgentMode, type AgentMode } from './agentMode'
import { useProviderStore } from '../stores/provider'

function activeToolList(extra: ToolDefinition[] = [], mode?: AgentMode): ToolDefinition[] {
  const agentMode = mode ?? useProviderStore.getState().agentMode
  return filterToolsForAgentMode([...TOOLS, ...extra], agentMode)
}

// Convert tools to OpenAI format. `extra` carries dynamically-discovered
// tools (currently just MCP servers) that aren't part of the static TOOLS list.
export function toolsToOpenAI(extra: ToolDefinition[] = [], mode?: AgentMode): Array<Record<string, unknown>> {
  return activeToolList(extra, mode).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

// Convert tools to Claude format
export function toolsToClaude(extra: ToolDefinition[] = [], mode?: AgentMode): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = activeToolList(extra, mode).map((t) => ({
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
