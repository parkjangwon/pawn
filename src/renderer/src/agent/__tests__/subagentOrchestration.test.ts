import { describe, it, expect } from 'vitest'
import {
  planExecutionWaves,
  buildSiblingFindingsBlock,
  mergeTaskPrompt,
  extractClaimsFromSummary,
  partitionWaveByFailPolicy,
  syntheticSkipResult,
  toStructuredFinding
} from '../subagentOrchestration'
import type { SubagentTask, SubagentResult } from '../subagent'
import { mapPool, buildSystemLayers } from '../subagent'
import { getBuiltinProfile } from '../agentProfiles'

describe('subagentOrchestration', () => {
  it('single wave when no depends_on', () => {
    const tasks: SubagentTask[] = [
      { name: 'a', prompt: 'map A' },
      { name: 'b', prompt: 'map B' }
    ]
    const { waves, cycleWarning } = planExecutionWaves(tasks)
    expect(waves).toHaveLength(1)
    expect(waves[0]).toHaveLength(2)
    expect(cycleWarning).toBeUndefined()
  })

  it('two waves for explore then worker', () => {
    const tasks: SubagentTask[] = [
      { name: 'scan-auth', prompt: 'find auth', agent: 'explore' },
      { name: 'scan-api', prompt: 'find api', agent: 'explore' },
      {
        name: 'implement',
        prompt: 'fix using findings',
        agent: 'worker',
        dependsOn: ['scan-auth', 'scan-api']
      }
    ]
    const { waves } = planExecutionWaves(tasks)
    expect(waves).toHaveLength(2)
    expect(waves[0].map((t) => t.name).sort()).toEqual(['scan-api', 'scan-auth'])
    expect(waves[1].map((t) => t.name)).toEqual(['implement'])
  })

  it('does not treat unknown depends_on as satisfied', () => {
    const tasks: SubagentTask[] = [
      { name: 'leaf', prompt: 'x', dependsOn: ['ghost'] }
    ]
    const { waves, cycleWarning } = planExecutionWaves(tasks)
    expect(cycleWarning).toMatch(/missing/)
    expect(waves.flat()).toHaveLength(1)
  })

  it('detects cycles and still schedules remaining', () => {
    const tasks: SubagentTask[] = [
      { name: 'a', prompt: 'a', dependsOn: ['b'] },
      { name: 'b', prompt: 'b', dependsOn: ['a'] }
    ]
    const { waves, cycleWarning } = planExecutionWaves(tasks)
    expect(cycleWarning).toBeTruthy()
    expect(waves.flat()).toHaveLength(2)
  })

  it('extracts claims and builds structured sibling block', () => {
    const completed: SubagentResult[] = [
      {
        name: 'scan',
        agent: 'explore',
        ok: true,
        summary: '### Summary\n- Found auth in src/auth.ts\n- Tokens live in middleware\n### Files\n- src/auth.ts',
        rounds: 2,
        toolsUsed: ['grep_search'],
        filesChanged: ['src/auth.ts']
      }
    ]
    const claims = extractClaimsFromSummary(completed[0].summary)
    expect(claims.some((c) => /auth/i.test(c))).toBe(true)
    const block = buildSiblingFindingsBlock(completed)
    expect(block).toContain('untrusted')
    expect(block).toContain('claims:')
    expect(block).toContain('src/auth.ts')
    expect(block).toContain('scan')
    const structured = toStructuredFinding(completed[0])
    expect(structured.files).toContain('src/auth.ts')
    expect(structured.claims.length).toBeGreaterThan(0)
  })

  it('merges shared context + sibling + task', () => {
    const text = mergeTaskPrompt(
      { prompt: 'Implement login', sharedContext: 'use JWT' },
      { sharedContext: 'repo uses TS', siblingFindings: '### scan\nok' }
    )
    expect(text).toContain('Shared context')
    expect(text).toContain('repo uses TS')
    expect(text).toContain('### scan')
    expect(text).toContain('Implement login')
  })

  it('skip policy partitions dependents of failed tasks', () => {
    const failed = new Set(['scan-a'])
    const wave: SubagentTask[] = [
      { name: 'impl', prompt: 'fix', dependsOn: ['scan-a'] },
      { name: 'other', prompt: 'ok' }
    ]
    const { run, skip } = partitionWaveByFailPolicy(wave, failed, 'skip')
    expect(run.map((t) => t.name)).toEqual(['other'])
    expect(skip).toHaveLength(1)
    expect(skip[0].reason).toMatch(/scan-a/)
  })

  it('continue policy runs everyone', () => {
    const { run, skip } = partitionWaveByFailPolicy(
      [{ name: 'impl', prompt: 'x', dependsOn: ['a'] }],
      new Set(['a']),
      'continue'
    )
    expect(run).toHaveLength(1)
    expect(skip).toHaveLength(0)
  })

  it('synthetic skip results are failed handles', () => {
    const r = syntheticSkipResult({ name: 'x', prompt: 'p', agent: 'worker' }, 'nope', 'batch-1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('nope')
    expect(r.batchId).toBe('batch-1')
  })

  it('mapPool respects concurrency and preserves order', async () => {
    let live = 0
    let maxLive = 0
    const items = [1, 2, 3, 4, 5]
    const out = await mapPool(items, 2, async (n) => {
      live++
      maxLive = Math.max(maxLive, live)
      await new Promise((r) => setTimeout(r, 15))
      live--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(maxLive).toBeLessThanOrEqual(2)
  })

  it('system layers include injection defense and stay stable', () => {
    const worker = getBuiltinProfile('worker')!
    const layers = buildSystemLayers(worker)
    expect(layers[0]).toContain('Hard rules')
    expect(layers[0]).toContain('untrusted')
    expect(layers[0]).toContain('Do not modify')
    expect(layers[1]).toContain('Profile: worker')
    expect(layers[1]).toMatch(/pathDeny|maxEdits/)
    expect(buildSystemLayers(worker)).toEqual(layers)
  })
})
