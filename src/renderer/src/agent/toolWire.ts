import { TOOLS, type ToolDefinition } from './toolDefinitions'

// Convert tools to OpenAI format. `extra` carries dynamically-discovered
// tools (currently just MCP servers) that aren't part of the static TOOLS list.
export function toolsToOpenAI(extra: ToolDefinition[] = []): Array<Record<string, unknown>> {
  return [...TOOLS, ...extra].map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

// Convert tools to Claude format
export function toolsToClaude(extra: ToolDefinition[] = []): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [...TOOLS, ...extra].map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }))
  // Tool schemas never change, so cache the whole definitions block. This is one
  // of the largest stable prefixes and a big cache-hit win on every turn.
  if (tools.length > 0) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } }
  }
  return tools
}
