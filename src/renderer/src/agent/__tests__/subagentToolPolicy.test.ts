import { describe, it, expect } from 'vitest'
import {
  matchPathGlob,
  checkSubagentToolCall,
  emptyToolBudget,
  applyBudget,
  extractToolPaths,
  toProjectRelative,
  nextPolicyBlockStreak,
  shouldEarlyStopPolicy,
  MAX_CONSECUTIVE_POLICY_BLOCKS
} from '../subagentToolPolicy'

describe('subagentToolPolicy', () => {
  it('matches simple and ** globs', () => {
    expect(matchPathGlob('src/**', 'src/a/b.ts')).toBe(true)
    expect(matchPathGlob('src/*', 'src/a/b.ts')).toBe(false)
    expect(matchPathGlob('*.ts', 'foo.ts')).toBe(true)
    expect(matchPathGlob('**/.env', 'pkg/.env')).toBe(true)
    expect(matchPathGlob('.env.*', '.env.local')).toBe(true)
    expect(matchPathGlob('package.json', 'package.json')).toBe(true)
  })

  it('extracts path args and relativizes worktrees', () => {
    expect(extractToolPaths({ name: 'edit_file', arguments: { path: 'src/x.ts' } })).toEqual([
      'src/x.ts'
    ])
    expect(toProjectRelative('/proj/.pawn/worktrees/r1/src/a.ts', '/proj')).toBe('src/a.ts')
  })

  it('enforces pathDeny before edits', () => {
    const budget = emptyToolBudget()
    const d = checkSubagentToolCall(
      { name: 'edit_file', arguments: { path: '.env' } },
      {
        pathDeny: ['.env', '.env.*'],
        maxEdits: 10
      },
      budget,
      { projectPath: '/proj' }
    )
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/pathDeny/i)
  })

  it('enforces pathAllow on mutating tools', () => {
    const budget = emptyToolBudget()
    const deny = checkSubagentToolCall(
      { name: 'edit_file', arguments: { path: 'docs/readme.md' } },
      { pathAllow: ['src/**'] },
      budget
    )
    expect(deny.allowed).toBe(false)
    const ok = checkSubagentToolCall(
      { name: 'edit_file', arguments: { path: 'src/app.ts' } },
      { pathAllow: ['src/**'] },
      budget
    )
    expect(ok.allowed).toBe(true)
  })

  it('allows read outside pathAllow', () => {
    const budget = emptyToolBudget()
    const d = checkSubagentToolCall(
      { name: 'read_file', arguments: { path: 'docs/x.md' } },
      { pathAllow: ['src/**'] },
      budget
    )
    expect(d.allowed).toBe(true)
  })

  it('enforces maxEdits budget', () => {
    const budget = emptyToolBudget()
    budget.edits = 2
    const d = checkSubagentToolCall(
      { name: 'edit_file', arguments: { path: 'src/a.ts' } },
      { maxEdits: 2 },
      budget
    )
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/maxEdits/)
  })

  it('enforces maxShell and maxToolCalls', () => {
    const b1 = emptyToolBudget()
    b1.shell = 1
    expect(
      checkSubagentToolCall(
        { name: 'shell_exec', arguments: { command: 'ls' } },
        { maxShell: 1 },
        b1
      ).allowed
    ).toBe(false)

    const b2 = emptyToolBudget()
    b2.total = 5
    expect(
      checkSubagentToolCall(
        { name: 'read_file', arguments: { path: 'a.ts' } },
        { maxToolCalls: 5 },
        b2
      ).allowed
    ).toBe(false)
  })

  it('applyBudget increments counters', () => {
    const b = emptyToolBudget()
    applyBudget(b, { allowed: true, countAsEdit: true })
    applyBudget(b, { allowed: true, countAsShell: true })
    expect(b.edits).toBe(1)
    expect(b.shell).toBe(1)
    expect(b.total).toBe(2)
  })

  it('honors disallowedTools', () => {
    const d = checkSubagentToolCall(
      { name: 'spawn_agent', arguments: {} },
      { disallowedTools: ['spawn_agent'] },
      emptyToolBudget()
    )
    expect(d.allowed).toBe(false)
  })

  it('tracks policy block streak and early-stops', () => {
    expect(
      nextPolicyBlockStreak(0, { totalCalls: 2, blockedCount: 2, anyAllowed: false })
    ).toBe(1)
    expect(
      nextPolicyBlockStreak(2, { totalCalls: 1, blockedCount: 0, anyAllowed: true })
    ).toBe(0)
    const storm = shouldEarlyStopPolicy({
      streak: MAX_CONSECUTIVE_POLICY_BLOCKS,
      blockedReasons: ['Path blocked by pathDeny: .env']
    })
    expect(storm.stop).toBe(true)
    expect(storm.reason).toMatch(/policy_block_storm/)

    const budget = shouldEarlyStopPolicy({
      streak: 0,
      blockedReasons: ['Edit budget exhausted (maxEdits=2)']
    })
    expect(budget.stop).toBe(true)
    expect(budget.reason).toMatch(/budget/i)
  })
})
