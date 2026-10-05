import type { ToolDefinition } from '../toolDefinitionsTypes'
import { getModRuntime } from './runtime'

/** Mod tools registered with `$.tool.register`, in the model catalog shape. */
export function getModToolDefinitions(): ToolDefinition[] {
  return getModRuntime()
    .getTools()
    .map((t) => ({
      name: t.fullName,
      description: t.description || t.name,
      parameters:
        t.inputSchema && typeof t.inputSchema === 'object'
          ? t.inputSchema
          : { type: 'object', properties: {} }
    }))
}
