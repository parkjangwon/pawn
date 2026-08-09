/**
 * Hermetic agent-path tests (no live LLM).
 * Covers guards and wiring for the post-upgrade tool ecosystem.
 */
import { describe, it, expect } from 'vitest'
import { validateCommitMessage } from '../gitWrite'
import {
  isSubagentToolAllowed,
  formatSubagentResults,
  MAX_PARALLEL_SUBAGENTS,
  planExecutionWaves,
  partitionWaveByFailPolicy,
  buildSiblingFindingsBlock,
  checkSubagentToolCall,
  emptyToolBudget,
  normalizeSubagentTask
} from '../subagent'
import { isMutatingTool, isToolAllowedInAgentMode } from '../agentMode'
import { TOOLS, TOOL_SAFETY } from '../tools'
import { MCP_TEMPLATES } from '../mcpTemplates'
import { getBuiltinProfile } from '../agentProfiles'

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
      {
        name: 'a',
        agent: 'explore',
        ok: true,
        summary: 'mapped module A',
        rounds: 2,
        toolsUsed: ['repo_map']
      },
      {
        name: 'b',
        agent: 'worker',
        ok: false,
        summary: '',
        rounds: 1,
        toolsUsed: [],
        error: 'aborted'
      }
    ])
    expect(text).toContain('## a')
    expect(text).toContain('FAIL')
  })

  it('MCP templates cover stdio and remote http', () => {
    expect(MCP_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    expect(MCP_TEMPLATES.some((t) => t.input && 'url' in t.input)).toBe(true)
    expect(MCP_TEMPLATES.some((t) => 'command' in t.input && t.input.command)).toBe(true)
  })

  it('pipeline wave + skip policy + structured siblings (hermetic orchestration)', () => {
    const tasks = [
      { name: 'scan-a', prompt: 'map auth' },
      { name: 'scan-b', prompt: 'map api' },
      { name: 'impl', prompt: 'implement', dependsOn: ['scan-a', 'scan-b'] }
    ]
    const { waves } = planExecutionWaves(tasks)
    expect(waves).toHaveLength(2)

    const failed = new Set(['scan-a'])
    const { run, skip } = partitionWaveByFailPolicy(waves[1], failed, 'skip')
    expect(run).toHaveLength(0)
    expect(skip[0].task.name).toBe('impl')

    const block = buildSiblingFindingsBlock([
      {
        name: 'scan-a',
        agent: 'explore',
        ok: false,
        summary: '- crashed',
        rounds: 1,
        toolsUsed: [],
        error: 'tool loop'
      },
      {
        name: 'scan-b',
        agent: 'explore',
        ok: true,
        summary: '- API in src/api.ts',
        rounds: 2,
        toolsUsed: ['grep_search'],
        filesChanged: ['src/api.ts']
      }
    ])
    expect(block).toContain('claims:')
    expect(block).toContain('scan-b')
  })

  it('worker builtin denies .env edits via path policy', () => {
    const worker = getBuiltinProfile('worker')!
    const d = checkSubagentToolCall(
      { name: 'edit_file', arguments: { path: '.env' } },
      worker,
      emptyToolBudget()
    )
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/pathDeny|blocked/i)
  })

  it('normalizes parallel prompts to profiles', () => {
    expect(normalizeSubagentTask({ prompt: 'Implement the cache layer' }).agent).toBe('worker')
    expect(normalizeSubagentTask({ prompt: 'Where is auth middleware?' }).agent).toBe('explore')
  })
})
