export type { ToolDefinition, ToolCall, ToolResult } from './toolDefinitionsTypes'

import type { ToolDefinition } from './toolDefinitionsTypes'
import { FS_TOOLS } from './toolDefs/fs'
import { SHELL_TOOLS } from './toolDefs/shell'
import { GIT_TOOLS } from './toolDefs/git'
import { COMPUTER_TOOLS } from './toolDefs/computer'
import { BROWSER_TOOLS } from './toolDefs/browser'
import { WEB_TOOLS } from './toolDefs/web'
import { WIKI_TOOLS } from './toolDefs/wiki'
import { APP_TOOLS } from './toolDefs/app'
import { CONNECTIONS_TOOLS } from './toolDefs/connections'
import { AGENT_TOOLS } from './toolDefs/agent'
import { LSP_TOOLS } from './toolDefs/lsp'
import { BROWSER_RUNTIME_TOOLS, CODE_INTEL_TOOLS, RUNTIME_TOOLS } from './toolDefs/runtime'
import { DEBUG_TOOLS } from './toolDefs/debug'
import { DECISION_TOOLS } from './toolDefs/decision'
import { SKILL_TOOLS } from './toolDefs/skills'

/** Tool definitions sent to the LLM (concatenated by domain modules). */
export const TOOLS: ToolDefinition[] = [
  ...FS_TOOLS,
  ...LSP_TOOLS,
  ...CODE_INTEL_TOOLS,
  ...SHELL_TOOLS,
  ...RUNTIME_TOOLS,
  ...DEBUG_TOOLS,
  ...GIT_TOOLS,
  ...COMPUTER_TOOLS,
  ...BROWSER_TOOLS,
  ...BROWSER_RUNTIME_TOOLS,
  ...WEB_TOOLS,
  ...WIKI_TOOLS,
  ...APP_TOOLS,
  ...CONNECTIONS_TOOLS,
  ...AGENT_TOOLS,
  ...DECISION_TOOLS,
  ...SKILL_TOOLS
]
