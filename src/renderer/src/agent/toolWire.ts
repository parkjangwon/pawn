import { TOOLS } from './toolDefinitions'

// Convert tools to OpenAI format
export function toolsToOpenAI(): Array<Record<string, unknown>> {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

// Convert tools to Claude format
export function toolsToClaude(): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = TOOLS.map((t) => ({
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
