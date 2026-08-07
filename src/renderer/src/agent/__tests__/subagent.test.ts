import { describe, it, expect } from 'vitest'
import { isSubagentToolAllowed, formatSubagentResults } from '../subagent'

describe('subagent policy', () => {
  it('explore mode is read-only', () => {
    expect(isSubagentToolAllowed('read_file', 'explore')).toBe(true)
    expect(isSubagentToolAllowed('repo_map', 'explore')).toBe(true)
    expect(isSubagentToolAllowed('edit_file', 'explore')).toBe(false)
    expect(isSubagentToolAllowed('shell_exec', 'explore')).toBe(false)
    expect(isSubagentToolAllowed('spawn_agent', 'explore')).toBe(false)
  })

  it('worker mode allows edits but not nested spawn', () => {
    expect(isSubagentToolAllowed('edit_file', 'worker')).toBe(true)
    expect(isSubagentToolAllowed('git_commit', 'worker')).toBe(true)
    expect(isSubagentToolAllowed('spawn_agent', 'worker')).toBe(false)
    expect(isSubagentToolAllowed('parallel_agents', 'worker')).toBe(false)
  })

  it('formats results', () => {
    const text = formatSubagentResults([
      { name: 'a', ok: true, summary: 'done', rounds: 2, toolsUsed: ['read_file'] }
    ])
    expect(text).toContain('## a')
    expect(text).toContain('done')
  })
})
