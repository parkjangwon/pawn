export type { ToolDefinition, ToolCall, ToolResult } from './toolDefinitionsTypes'

import type { ToolDefinition } from './toolDefinitionsTypes'
import { FS_TOOLS } from './toolDefs/fs'
import { SHELL_TOOLS } from './toolDefs/shell'
import { GIT_TOOLS } from './toolDefs/git'
import { COMPUTER_TOOLS } from './toolDefs/computer'
import { BROWSER_TOOLS } from './toolDefs/browser'
import { WEB_TOOLS } from './toolDefs/web'
import { MEMORY_TOOLS } from './toolDefs/memory'
import { APP_TOOLS } from './toolDefs/app'
import { CONNECTIONS_TOOLS } from './toolDefs/connections'
import { AGENT_TOOLS } from './toolDefs/agent'

/** Tool definitions sent to the LLM (concatenated by domain modules). */
export const TOOLS: ToolDefinition[] = [
  ...FS_TOOLS,
  ...SHELL_TOOLS,
  ...GIT_TOOLS,
  ...COMPUTER_TOOLS,
  ...BROWSER_TOOLS,
  ...WEB_TOOLS,
  ...MEMORY_TOOLS,
  ...APP_TOOLS,
  ...CONNECTIONS_TOOLS,
  ...AGENT_TOOLS
]
