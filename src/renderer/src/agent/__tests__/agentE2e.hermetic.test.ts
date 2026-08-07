/**
 * Hermetic agent-path tests (no live LLM).
 * Covers guards and wiring for the post-upgrade tool ecosystem.
 */
import { describe, it, expect } from 'vitest'
import { validateCommitMessage } from '../gitWrite'
import {
  isSubagentToolAllowed,
  formatSubagentResults,
  MAX_PARALLEL_SUBAGENTS
} from '../subagent'
import { isMutatingTool, isToolAllowedInAgentMode } from '../agentMode'
import { TOOLS, TOOL_SAFETY } from '../tools'
import { MCP_TEMPLATES } from '../mcpTemplates'

describe('hermetic agent ecosystem', () => {
  it('registers critical new tools with safety levels', () => {
    for (const n of [
      'spawn_agent',
      'parallel_agents',
      'git_commit',
      'git_push',
      'google_gmail_send',
      'memory_consolidate'
    ]) {
      expect(TOOLS.some((t) => t.name === n), n).toBe(true)
      expect(TOOL_SAFETY[n], n).toBeDefined()
    }
  })

  it('git commit message guards', () => {
    expect(validateCommitMessage('feat: ship subagents')).toBeNull()
    expect(validateCommitMessage('wip')).toBeTruthy()
  })

  it('subagent explore is read-only; worker cannot nest', () => {
    expect(isSubagentToolAllowed('read_file', 'explore')).toBe(true)
    expect(isSubagentToolAllowed('edit_file', 'explore')).toBe(false)
    expect(isSubagentToolAllowed('spawn_agent', 'worker')).toBe(false)
    expect(MAX_PARALLEL_SUBAGENTS).toBe(6)
  })

  it('plan mode blocks mutating git/write/subagent tools', () => {
    expect(isMutatingTool('git_commit')).toBe(true)
    expect(isToolAllowedInAgentMode('git_commit', 'plan')).toBe(false)
    expect(isToolAllowedInAgentMode('spawn_agent', 'plan')).toBe(false)
    expect(isToolAllowedInAgentMode('read_file', 'plan')).toBe(true)
  })

  it('formats multi-subagent results', () => {
    const text = formatSubagentResults([
      { name: 'a', ok: true, summary: 'mapped module A', rounds: 2, toolsUsed: ['repo_map'] },
      { name: 'b', ok: false, summary: '', rounds: 1, toolsUsed: [], error: 'aborted' }
    ])
    expect(text).toContain('## a')
    expect(text).toContain('FAIL')
  })

  it('MCP templates cover stdio and remote http', () => {
    expect(MCP_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    expect(MCP_TEMPLATES.some((t) => t.input && 'url' in t.input)).toBe(true)
    expect(MCP_TEMPLATES.some((t) => 'command' in t.input && t.input.command)).toBe(true)
  })
})
