export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  /** Anthropic client toolset the call belongs to (e.g. "computer"). */
  toolset?: string
}

export interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
  diffData?: { oldText: string; newText: string; filename: string; path?: string }
  /** SSH host id when the command executed remotely (see executionTarget). */
  host?: string
}
