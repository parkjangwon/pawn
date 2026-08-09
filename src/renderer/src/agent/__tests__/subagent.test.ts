import { describe, it, expect } from 'vitest'
import {
  isSubagentToolAllowed,
  formatSubagentResults,
  buildSystemLayers,
  subagentStickySessionId,
  buildSubagentPreamble,
  profileMaxTier,
  compactSubagentSummary,
  normalizeSubagentTask,
  normalizeParallelTasks
} from '../subagent'
import { getBuiltinProfile, serializeAgentProfile, parseAgentMarkdown, profileFromMarkdown } from '../agentProfiles'

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

  it('formats results with agent + apply metadata + claims', () => {
    const text = formatSubagentResults([
      {
        name: 'a',
        agent: 'worker',
        ok: true,
        summary: '### Summary\n- Fixed auth middleware in src/a.ts\n- Added regression test\ndone',
        rounds: 2,
        toolsUsed: ['read_file'],
        filesChanged: ['src/a.ts'],
        applied: true
      }
    ])
    expect(text).toContain('## a')
    expect(text).toContain('[worker]')
    expect(text).toContain('done')
    expect(text).toMatch(/applied/)
    expect(text).toMatch(/claims:/)
  })

  it('keeps system layers free of per-run labels (prompt cache)', () => {
    const explore = getBuiltinProfile('explore')!
    const layers = buildSystemLayers(explore)
    expect(layers.length).toBe(2)
    const joined = layers.join('\n')
    expect(joined).toContain('Profile: explore')
    expect(joined).not.toContain('Label:')
    // Same profile → identical system bytes every time
    expect(buildSystemLayers(explore)).toEqual(layers)
  })

  it('sticky session id is stable per project+profile', () => {
    expect(subagentStickySessionId('proj-1', 'explore')).toBe(
      subagentStickySessionId('proj-1', 'explore')
    )
    expect(subagentStickySessionId('proj-1', 'explore')).not.toBe(
      subagentStickySessionId('proj-1', 'worker')
    )
  })

  it('preamble carries run-specific fields outside system', () => {
    const p = buildSubagentPreamble({
      toolCwd: '/tmp/wt-abc',
      projectPath: '/proj',
      isolation: 'worktree',
      thoroughness: 'Thoroughness: quick',
      taskName: 'scan-auth'
    })
    expect(p).toContain('scan-auth')
    expect(p).toContain('/proj')
    expect(p).toContain('worktree')
  })

  it('pins explore to low tier and plan to mid', () => {
    expect(profileMaxTier('explore', 'simple')).toBe('low')
    expect(profileMaxTier('explore', 'inherit')).toBe('low')
    expect(profileMaxTier('plan', 'inherit')).toBe('mid')
    expect(profileMaxTier('worker', 'inherit')).toBeUndefined()
  })

  it('applies global cost mode frugal | balanced | quality', () => {
    expect(profileMaxTier('worker', 'inherit', 'frugal')).toBe('mid')
    expect(profileMaxTier('explore', 'inherit', 'frugal')).toBe('low')
    expect(profileMaxTier('explore', 'inherit', 'quality')).toBeUndefined()
    expect(profileMaxTier('worker', 'inherit', 'quality')).toBeUndefined()
    expect(profileMaxTier('plan', 'inherit', 'balanced')).toBe('mid')
    // explicit pref still wins under quality
    expect(profileMaxTier('explore', 'simple', 'quality')).toBe('low')
  })

  it('compacts parent-facing summaries with cost footer', () => {
    const s = compactSubagentSummary('Found the auth middleware in src/auth.ts', {
      agent: 'explore',
      toolsUsed: ['grep_search', 'read_file'],
      usage: {
        calls: 2,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
        cost: 0.0012,
        cacheHitRate: 0.8,
        modelLabel: 'flash'
      }
    })
    expect(s).toContain('### Summary')
    expect(s).toContain('cache 80%')
    expect(s).toContain('explore')
    expect(s.length).toBeLessThan(2000)
  })

  it('surfaces apply conflicts in compact summaries', () => {
    const s = compactSubagentSummary('done', {
      agent: 'worker',
      applied: true,
      applyConflicts: ['src/a.ts', 'src/b.ts']
    })
    expect(s).toContain('Apply conflicts')
    expect(s).toContain('src/a.ts')
  })

  it('infers agent from prompt for parallel fan-out', () => {
    expect(normalizeSubagentTask({ prompt: 'Implement the login form' }).agent).toBe('worker')
    expect(normalizeSubagentTask({ prompt: 'Find where auth tokens are stored' }).agent).toBe(
      'explore'
    )
    expect(normalizeSubagentTask({ prompt: 'Plan the migration steps' }).agent).toBe('plan')
    expect(normalizeSubagentTask({ prompt: 'Review the PR for security issues' }).agent).toBe(
      'code-reviewer'
    )
    // Explicit wins
    expect(normalizeSubagentTask({ prompt: 'Implement X', agent: 'explore' }).agent).toBe('explore')
  })

  it('normalizes parallel batches and caps at MAX', () => {
    const tasks = normalizeParallelTasks([
      { prompt: 'map module A' },
      { prompt: 'map module B' },
      { prompt: 'Implement fix in C' }
    ])
    expect(tasks).toHaveLength(3)
    expect(tasks[0].agent).toBe('explore')
    expect(tasks[2].agent).toBe('worker')
  })

  it('round-trips skills in agent profile markdown', () => {
    const md = serializeAgentProfile({
      name: 'with-skills',
      description: 'test',
      systemPrompt: 'You research.',
      model: 'simple',
      maxTurns: 8,
      isolation: 'none',
      apply: 'none',
      skills: ['pdf', 'git-helpers']
    })
    expect(md).toContain('skills: pdf, git-helpers')
    const { meta } = parseAgentMarkdown(md, 'with-skills')
    expect(meta.skills).toContain('pdf')
    const profile = profileFromMarkdown(md, 'with-skills', 'project', '/tmp/x.md')
    expect(profile?.skills).toEqual(['pdf', 'git-helpers'])
  })
})
