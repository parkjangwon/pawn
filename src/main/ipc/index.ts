import { registerDialogIpc } from './dialog'
import { registerFsIpc } from './fs'
import { registerShellIpc } from './shell'
import { registerComputerIpc } from './computer'
import { registerMiscIpc } from './misc'
import { registerConfigIpc } from './config'
import { registerDbIpc } from './db'
import { registerBrowserIpc } from './browser'
import { registerTerminalIpc } from './terminal'
import { registerRoutineIpc } from './routine'
import { registerKeybindingsIpc } from './keybindings'
import { registerMcpIpc } from './mcp'
import { registerConnectionsIpc } from './connections'
import { registerResearchIpc } from './research'
import { registerWikiIpc } from './wiki'
import { registerHooksIpc } from './hooks'
import { registerModsIpc } from './mods'
import { registerWorktreeIpc } from './worktree'
import { registerLspIpc } from './lsp'
import { registerAgentRuntimeIpc } from './agentRuntime'
import { registerKiroIpc } from './kiro'
import { registerXaiIpc } from './xai'
import { registerChatGptIpc } from './chatgpt'
import { registerClaudeOauthIpc } from './claudeOauth'
import { registerAntigravityIpc } from './antigravity'
import { registerSkillsIpc } from './skills'
import { registerDecisionIpc } from './decision'
import { registerRecorderIpc } from './recorder'
import { registerTelegramIpc } from './telegram'
import { registerSshIpc } from './ssh'

/** Register every main-process IPC handler in one place. */
export function registerAllIpc(): void {
  registerDialogIpc()
  registerFsIpc()
  registerShellIpc()
  registerComputerIpc()
  registerMiscIpc()
  registerConfigIpc()
  registerDbIpc()
  registerBrowserIpc()
  registerTerminalIpc()
  registerRoutineIpc()
  registerKeybindingsIpc()
  registerMcpIpc()
  registerConnectionsIpc()
  registerResearchIpc()
  registerWikiIpc()
  registerHooksIpc()
  registerModsIpc()
  registerWorktreeIpc()
  registerLspIpc()
  registerAgentRuntimeIpc()
  registerKiroIpc()
  registerXaiIpc()
  registerChatGptIpc()
  registerClaudeOauthIpc()
  registerAntigravityIpc()
  registerSkillsIpc()
  registerDecisionIpc()
  registerRecorderIpc()
  registerTelegramIpc()
  registerSshIpc()
}
