import type { ToolCall, ToolResult } from '../toolDefinitionsTypes'

export type ToolExecContext = {
  sessionId?: string
  /** When true, handler is running inside a nested subagent loop. */
  subagent?: boolean
  projectId?: string
}

export type ToolHandler = (
  call: ToolCall,
  projectPath: string | undefined,
  signal: AbortSignal | undefined,
  ctx: ToolExecContext | undefined,
  api: typeof window.api
) => Promise<ToolResult>
