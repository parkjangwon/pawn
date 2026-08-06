import type { ToolDefinition } from '../toolDefinitionsTypes'
import { GOOGLE_CONNECTION_TOOLS } from './connections_google'
import { GITHUB_CONNECTION_TOOLS } from './connections_github'
import { GITLAB_CONNECTION_TOOLS } from './connections_gitlab'
import { CODECOMMIT_CONNECTION_TOOLS } from './connections_codecommit'

export const CONNECTIONS_TOOLS: ToolDefinition[] = [
  ...GOOGLE_CONNECTION_TOOLS,
  ...GITHUB_CONNECTION_TOOLS,
  ...GITLAB_CONNECTION_TOOLS,
  ...CODECOMMIT_CONNECTION_TOOLS
]
