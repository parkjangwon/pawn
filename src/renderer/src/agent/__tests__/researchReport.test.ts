import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SubagentResult } from '../subagent'

vi.mock('../subagent', () => ({
  extractClaimsFromSummary: (s: string, max?: number) =>
    (String(s).match(/claim\d+/g) || []).slice(0, max),
  runParallelSubagents: vi.fn(),
  runSubagent: vi.fn()
}))

import {
  buildResearchDossier,
  buildResearchPrompt,
  buildSynthesisPrompt,
  dedupeUrls,
  extractUrls,
  parseAspectList,
  runResearchReport,
  slugify
} from '../researchReport'
import { runParallelSubagents, runSubagent } from '../subagent'

const mockedRunParallel = vi.mocked(runParallelSubagents)
const mockedRunSubagent = vi.mocked(runSubagent)

function fakeResult(name: string, ok = true): SubagentResult {
  return {
    name,
    agent: 'explore',
    ok,
    summary:
      `## ${name}\nclaim1 from https://a.dev/x\nclaim2 from https://b.dev/y?q=1`,
    rounds: 2,
    toolsUsed: ['web_fetch']
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('researchReport pure helpers', () => {
  it('slugifies topics into artifact-safe names', () => {
    expect(slugify('Rust vs Go: 2025')).toBe('rust-vs-go-2025')
    // Non-ascii collapses to the 'research' fallback (slug never returns '').
    expect(slugify('한글 토픽')).toBe('research')
  })

  it('parses planner output into aspects (bare / fenced / prose-wrapped)', () => {
    expect(parseAspectList('["a", "b", "c"]')).toEqual(['a', 'b', 'c'])
    expect(parseAspectList('```json\n["x", "y"]\n```')).toEqual(['x', 'y'])
    expect(parseAspectList('Here are the aspects: ["p", "q"] — enjoy')).toEqual(['p', 'q'])
    expect(parseAspectList('not json at all')).toEqual([])
    expect(parseAspectList('[]')).toEqual([])
  })

  it('extracts and dedupes source URLs (normalized, first-seen order)', () => {
    const urls = extractUrls('see https://a.dev/x and https://a.dev/x and http://b.dev/y.')
    expect(dedupeUrls(urls)).toEqual(['https://a.dev/x', 'http://b.dev/y'])
  })

  it('builds a dossier with per-worker claims and a deduplicated source list', () => {
    const dossier = buildResearchDossier([fakeResult('r1'), fakeResult('r2')])
    expect(dossier).toContain('## r1 [explore] — ok')
    expect(dossier).toContain('- claim1')
    expect(dossier).toContain('## Deduplicated source URLs (cite ONLY these)')
    expect(dossier).toContain('- https://a.dev/x')
    // a.dev/x appears in both worker bodies, but the source list dedupes it.
    const sourceSection = dossier.split('## Deduplicated source URLs')[1]
    expect(sourceSection.match(/https:\/\/a\.dev\/x/g)?.length).toBe(1)
  })

  it('builds research and synthesis prompts that reference the right constraints', () => {
    const research = buildResearchPrompt('current market', 'LLM agents', 5)
    expect(research).toContain('own browser tab')
    expect(research).toContain('up to 5 distinct sources')
    expect(research).toContain('Never invent URLs')
    const synth = buildSynthesisPrompt({
      topic: 'LLM agents',
      aspects: ['market'],
      dossier: 'D',
      outputPath: 'research/r.md'
    })
    expect(synth).toContain('Executive Summary')
    expect(synth).toContain('Cite only URLs from the "Deduplicated source URLs"')
    expect(synth).toContain('write_artifact')
  })
})

describe('runResearchReport orchestration', () => {
  it('requires a topic', async () => {
    const res = await runResearchReport({ topic: '  ' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('topic is required')
    expect(mockedRunParallel).not.toHaveBeenCalled()
  })

  it('runs parallel research from caller aspects then synthesizes with a dossier', async () => {
    mockedRunParallel.mockResolvedValue([fakeResult('research-1'), fakeResult('research-2', false)])
    mockedRunSubagent.mockResolvedValue({
      name: 'synthesize-report',
      agent: 'worker',
      ok: true,
      summary: '# Report\nDone',
      rounds: 1,
      toolsUsed: ['write_artifact']
    })

    const res = await runResearchReport({
      topic: 'LLM agents',
      aspects: ['market', 'tech'],
      maxSources: 6,
      outputPath: 'research/r.md',
      projectPath: '/p',
      projectId: 'prj',
      sessionId: 's1'
    })

    expect(res.ok).toBe(true)
    expect(res.aspects).toEqual(['market', 'tech'])
    // Parallel research: one explore task per aspect, capped by maxSubagents.
    const taskArg = mockedRunParallel.mock.calls[0][0]
    expect(taskArg.map((t) => t.name)).toEqual(['research-1', 'research-2'])
    expect(taskArg.every((t) => t.agent === 'explore')).toBe(true)
    expect(taskArg[0].prompt).toContain('up to 6 distinct sources')
    // Synthesis receives the dossier in its prompt, via the narrow synthesizer profile.
    const synthTask = mockedRunSubagent.mock.calls[0][0]
    expect(synthTask.agent).toBe('synthesizer')
    expect(synthTask.prompt).toContain('## Deduplicated source URLs')
    expect(synthTask.prompt).toContain('write_artifact')
    expect(res.report).toContain('# Report')
  })

  it('uses a planner subagent to decompose the topic when aspects are omitted', async () => {
    mockedRunSubagent.mockResolvedValueOnce({
      name: 'research-planner',
      agent: 'explore',
      ok: true,
      summary: '```json\n["a", "b"]\n```',
      rounds: 1,
      toolsUsed: []
    })
    mockedRunParallel.mockResolvedValue([fakeResult('research-1')])
    mockedRunSubagent.mockResolvedValue({
      name: 'synthesize-report',
      agent: 'worker',
      ok: true,
      summary: 'report',
      rounds: 1,
      toolsUsed: []
    })

    const res = await runResearchReport({ topic: 'LLM agents' })
    expect(res.aspects).toEqual(['a', 'b'])
    expect(mockedRunSubagent).toHaveBeenCalledTimes(2) // planner + synthesizer
    expect(mockedRunParallel.mock.calls[0][0].map((t) => t.prompt)).toHaveLength(2)
  })

  it('falls back to a single aspect when the planner output is unparsable', async () => {
    mockedRunSubagent.mockResolvedValueOnce({
      name: 'research-planner',
      agent: 'explore',
      ok: true,
      summary: 'garbage output',
      rounds: 1,
      toolsUsed: []
    })
    mockedRunParallel.mockResolvedValue([fakeResult('research-1')])
    mockedRunSubagent.mockResolvedValue({
      name: 'synthesize-report',
      agent: 'worker',
      ok: true,
      summary: 'report',
      rounds: 1,
      toolsUsed: []
    })

    const res = await runResearchReport({ topic: 'LLM agents' })
    expect(res.aspects).toEqual(['LLM agents'])
  })

  it('propagates synthesis failure', async () => {
    mockedRunParallel.mockResolvedValue([fakeResult('research-1')])
    mockedRunSubagent.mockResolvedValue({
      name: 'synthesize-report',
      agent: 'worker',
      ok: false,
      summary: '',
      error: 'LLM failed',
      rounds: 1,
      toolsUsed: []
    })
    const res = await runResearchReport({ topic: 't', aspects: ['a'] })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('LLM failed')
  })
})
