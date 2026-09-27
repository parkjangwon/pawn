import type { ToolHandler } from './types'
import { agentHandlers } from './agent'
import { appHandlers } from './app'
import { browserHandlers } from './browser'
import { computerHandlers } from './computer'
import { connectionsHandlers } from './connections'
import { fsHandlers } from './fs'
import { gitHandlers } from './git'
import { memoryHandlers } from './memory'
import { shellHandlers } from './shell'
import { webHandlers } from './web'
import { lspHandlers } from './lsp'
import { nativeHandlers } from './native'
import { runtimeHandlers } from './runtime'
import { debugHandlers } from './debug'

export type { ToolExecContext, ToolHandler } from './types'

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  ...agentHandlers,
  ...appHandlers,
  ...browserHandlers,
  ...computerHandlers,
  ...connectionsHandlers,
  ...fsHandlers,
  ...gitHandlers,
  ...memoryHandlers,
  ...shellHandlers,
  ...webHandlers,
  ...lspHandlers,
  ...nativeHandlers,
  ...runtimeHandlers,
  ...debugHandlers
}
