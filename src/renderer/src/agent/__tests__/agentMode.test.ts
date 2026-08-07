import { describe, it, expect } from 'vitest'
import {
  isMutatingTool,
  isToolAllowedInAgentMode,
  filterToolsForAgentMode,
  parseAgentMode,
  parseDoneGate
} from '../agentMode'

describe('agentMode', () => {
  it('treats writes and shell as mutating', () => {
    expect(isMutatingTool('edit_file')).toBe(true)
    expect(isMutatingTool('write_file')).toBe(true)
    expect(isMutatingTool('shell_exec')).toBe(true)
    expect(isMutatingTool('browser_click')).toBe(true)
    expect(isMutatingTool('github_create_pull')).toBe(true)
    expect(isMutatingTool('git_commit')).toBe(true)
    expect(isMutatingTool('spawn_agent')).toBe(true)
    expect(isMutatingTool('google_gmail_send')).toBe(true)
  })

  it('keeps reads and planning tools non-mutating', () => {
    expect(isMutatingTool('read_file')).toBe(false)
    expect(isMutatingTool('codebase_search')).toBe(false)
    expect(isMutatingTool('repo_map')).toBe(false)
    expect(isMutatingTool('update_plan')).toBe(false)
    expect(isMutatingTool('run_checks')).toBe(false)
    expect(isMutatingTool('shell_poll')).toBe(false)
    expect(isMutatingTool('git_status')).toBe(false)
  })

  it('blocks mutating tools only in plan mode', () => {
    expect(isToolAllowedInAgentMode('edit_file', 'plan')).toBe(false)
    expect(isToolAllowedInAgentMode('edit_file', 'build')).toBe(true)
    expect(isToolAllowedInAgentMode('read_file', 'plan')).toBe(true)
  })

  it('filters tool lists for plan mode', () => {
    const tools = [{ name: 'read_file' }, { name: 'edit_file' }, { name: 'repo_map' }]
    expect(filterToolsForAgentMode(tools, 'plan').map((t) => t.name)).toEqual([
      'read_file',
      'repo_map'
    ])
  })

  it('parses settings values safely', () => {
    expect(parseAgentMode('plan')).toBe('plan')
    expect(parseAgentMode('nope')).toBe('build')
    expect(parseDoneGate('test')).toBe('test')
    expect(parseDoneGate(null)).toBe('typecheck')
  })
})
