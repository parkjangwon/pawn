// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildSummaryRequest,
  compactWithSummary,
  parseSummaryResponse,
  pickSummaryModel,
  renderForSummary
} from '../compaction'
import { compactTranscript, compactionCut, type TranscriptEntry } from '../transcript'
import { useProviderStore } from '../../stores/provider'

const user = (content: string): TranscriptEntry => ({ role: 'user', content })
const asst = (content: string, calls: Array<{ id: string; name: string; path?: string }> = []): TranscriptEntry => ({
  role: 'assistant',
  content,
  ...(calls.length
    ? { toolCalls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.path ? { path: c.path } : {} })) }
    : {})
})
const tool = (id: string, name: string, content: string, isError = false): TranscriptEntry => ({
  role: 'tool',
  toolCallId: id,
  name,
  content,
  ...(isError ? { isError: true } : {})
})

function longSession(turns: number, bodyChars = 2000): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  for (let i = 0; i < turns; i++) {
    out.push(user(`ask ${i}`))
    out.push(asst('', [{ id: `t${i}`, name: 'read_file', path: `/src/f${i}.ts` }]))
    out.push(tool(`t${i}`, 'read_file', `content ${i} `.repeat(bodyChars / 10)))
    out.push(asst(`answer ${i}`))
  }
  return out
}

describe('compactionCut (token budget)', () => {
  it('keeps a token-budgeted tail and never starts on a tool result', () => {
    const entries = longSession(10)
    const cut = compactionCut(entries, { keepTokens: 1500, minKeep: 2 })
    expect(cut).toBeGreaterThan(0)
    expect(entries[cut].role).not.toBe('tool')
    expect(cut).toBeLessThan(entries.length)
  })

  it('keeps at least minKeep entries even if one exceeds the budget', () => {
    const entries = [user('a'), asst('b'), user('huge ' + 'x'.repeat(40_000)), asst('ok')]
    const cut = compactionCut(entries, { keepTokens: 10, minKeep: 2 })
    expect(entries.length - cut).toBeGreaterThanOrEqual(2)
  })

  it('returns -1 when everything fits', () => {
    expect(compactionCut([user('a'), asst('b')], { keepTokens: 100_000 })).toBe(-1)
  })
})

describe('heuristic compaction', () => {
  it('keeps the most recent tool results when over the preserved budget', () => {
    const entries: TranscriptEntry[] = []
    for (let i = 0; i < 20; i++) {
      entries.push(asst('', [{ id: `c${i}`, name: 'run_checks' }]))
      entries.push(tool(`c${i}`, 'run_checks', `RESULT-${i} ` + 'y'.repeat(560)))
    }
    entries.push(user('latest'), asst('done'))
    const out = compactTranscript(entries, 2)
    const summary = out[0].content
    expect(summary).toContain('RESULT-19')
    expect(summary).not.toContain('RESULT-0 ')
    // Chronological order is preserved among kept results.
    expect(summary.indexOf('RESULT-18')).toBeLessThan(summary.indexOf('RESULT-19'))
  })

  it('carries the current plan across compaction', () => {
    const entries = longSession(4)
    const out = compactTranscript(entries, {
      keepEntries: 2,
      plan: [
        { content: 'write tests', status: 'done' },
        { content: 'fix router', status: 'in_progress' },
        { content: 'ship', status: 'pending' }
      ]
    })
    const summary = out[0].content
    expect(summary).toContain('Current plan')
    expect(summary).toContain('[x] write tests')
    expect(summary).toContain('[~] fix router')
    expect(summary).toContain('[ ] ship')
  })

  it('uses a model summary instead of the digest when provided', () => {
    const out = compactTranscript(longSession(4), { keepEntries: 2, llmSummary: '## Goal\nShip the router' })
    expect(out[0].content).toContain('## Goal\nShip the router')
    expect(out[0].content).not.toContain('User asked:')
    // File list is still attached for the re-read reminder.
    expect(out[0].content).toContain('/src/f0.ts')
  })
})

describe('renderForSummary', () => {
  it('renders roles, tool calls, and errors, keeping the tail when over budget', () => {
    const text = renderForSummary([
      user('please fix'),
      asst('looking', [{ id: 'a', name: 'grep_search' }]),
      tool('a', 'grep_search', 'boom', true)
    ])
    expect(text).toContain('[user]\nplease fix')
    expect(text).toContain('→ grep_search')
    expect(text).toContain('[tool grep_search ERROR]')
    const clipped = renderForSummary(longSession(40), 2000)
    expect(clipped.startsWith('…[earliest part omitted]')).toBe(true)
    expect(clipped).toContain('answer 39')
  })
})

describe('summary request / response', () => {
  it('builds non-streaming bodies for both wire formats', () => {
    const claude = buildSummaryRequest({ apiFormat: 'claude' }, 'm', 'T')
    expect(claude).toMatchObject({ model: 'm', system: expect.any(String) })
    expect(claude.stream).toBeUndefined()
    const openai = buildSummaryRequest({ apiFormat: 'openai' }, 'm', 'T')
    expect(openai).toMatchObject({ model: 'm', stream: false })
    expect((openai.messages as any[])[0].role).toBe('system')
  })

  it('parses Claude and OpenAI responses with usage', () => {
    const c = parseSummaryResponse({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 3 }
    })
    expect(c).toEqual({ text: 'hello', usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    const o = parseSummaryResponse({
      choices: [{ message: { content: ' hi ' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, prompt_cache_hit_tokens: 4 }
    })
    expect(o.text).toBe('hi')
    expect(o.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 4 })
  })
})

describe('pickSummaryModel', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [
        { id: 'p1', name: 'P1', apiFormat: 'openai', baseUrl: 'https://x', enabled: true, apiKey: 'k' },
        { id: 'p2', name: 'P2', apiFormat: 'claude', baseUrl: 'https://y', enabled: true, apiKey: 'k' },
        { id: 'p3', name: 'P3', apiFormat: 'openai', baseUrl: 'https://z', enabled: false, apiKey: 'k' }
      ] as any,
      models: [
        { id: 'a', providerId: 'p1', modelId: 'big', label: 'Big', tier: 'high', enabled: true, contextWindow: 1_000_000 },
        { id: 'b', providerId: 'p2', modelId: 'small', label: 'Small', tier: 'low', enabled: true, contextWindow: 200_000 },
        { id: 'c', providerId: 'p3', modelId: 'off', label: 'Off', tier: 'low', enabled: true }
      ] as any
    })
  })

  it('prefers the cheapest tier on an enabled provider', () => {
    expect(pickSummaryModel(1000)?.model.modelId).toBe('small')
  })

  it('skips models whose window cannot hold the input', () => {
    expect(pickSummaryModel(199_000)?.model.modelId).toBe('big')
    expect(pickSummaryModel(2_000_000)).toBeNull()
  })
})

describe('compactWithSummary', () => {
  it('uses the model summary when available', async () => {
    const summarize = vi.fn().mockResolvedValue('## Goal\nRefactor router')
    const r = await compactWithSummary(longSession(30), {
      sessionId: 's',
      contextWindow: 24_000,
      summarize
    })
    expect(r.compacted).toBe(true)
    expect(r.usedModel).toBe(true)
    expect(r.entries[0].content).toContain('Refactor router')
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('falls back to the heuristic digest when the model call fails', async () => {
    const r = await compactWithSummary(longSession(30), {
      sessionId: 's',
      contextWindow: 24_000,
      summarize: vi.fn().mockResolvedValue(null)
    })
    expect(r.compacted).toBe(true)
    expect(r.usedModel).toBe(false)
    expect(r.entries[0].content).toContain('User asked:')
  })

  it('skips the model entirely when disabled', async () => {
    const summarize = vi.fn()
    const r = await compactWithSummary(longSession(30), {
      sessionId: 's',
      contextWindow: 24_000,
      useModel: false,
      summarize
    })
    expect(summarize).not.toHaveBeenCalled()
    expect(r.compacted).toBe(true)
  })

  it('does nothing when the transcript already fits the tail budget', async () => {
    const entries = longSession(1, 100)
    const r = await compactWithSummary(entries, { sessionId: 's', contextWindow: 200_000, summarize: vi.fn() })
    expect(r).toEqual({ entries, compacted: false, usedModel: false })
  })
})
