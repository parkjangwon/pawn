/**
 * Hermetic runSubagent tests — no live LLM, no filesystem.
 *
 * The subagent loop's two external touchpoints are mocked:
 * - `route` (router.ts) → fixed fake decision
 * - `callLLM` (llm.ts) → scripted responses
 *
 * This lets us exercise the real loop (start → rounds → finish → finally)
 * including the crash path and the side-panel close debounce.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const harness = vi.hoisted(() => ({
  callLLM: vi.fn(),
  route: vi.fn(),
  subStart: vi.fn(),
  subStop: vi.fn()
}))

vi.mock('../mods/lifecycleEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mods/lifecycleEvents')>()),
  modSubagentStart: harness.subStart,
  modSubagentStop: harness.subStop
}))

vi.mock('../llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm')>()),
  callLLM: harness.callLLM
}))
vi.mock('../router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../router')>()),
  route: harness.route
}))

import { runSubagent } from '../subagent'
import { useSubagentRunsStore } from '../../stores/subagentRuns'

const fakeDecision = {
  provider: { id: 'fake' } as never,
  model: {
    providerId: 'fake',
    modelId: 'fake-1',
    label: 'Fake 1',
    pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  } as never,
  key: 'fake:fake-1',
  tier: 'low' as const,
  reason: 'test'
}

function finalAnswer(text: string): unknown {
  return {
    text,
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    reasoningContent: undefined
  }
}

const BASE_OPTS = {
  projectId: 'p1',
  sessionId: 's1',
  projectPath: undefined,
  forceBuiltinProfile: true
}

beforeEach(() => {
  useSubagentRunsStore.setState({ runs: [] })
  // usage.record() writes through window.api.db.addUsage (sync access — not
  // optional-chained), so stub the API surface in jsdom.
  ;(window as any).api = {
    db: {
      addUsage: vi.fn().mockResolvedValue(undefined),
      getUsageBySession: vi.fn().mockResolvedValue([]),
      getUsageSummary: vi.fn().mockResolvedValue([])
    }
  }
  harness.subStart.mockReset()
  harness.subStop.mockReset()
  harness.callLLM.mockReset().mockResolvedValue(finalAnswer('all done'))
  harness.route.mockReset().mockReturnValue(fakeDecision)
  ;(window as any).__subagentOpenedBrowserPanel = false
  ;(window as any).__closeRightPanel = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runSubagent hermetic', () => {
  it('runs to a terminal ok state and records the store run', async () => {
    const res = await runSubagent(
      { agent: 'explore', prompt: 'scan the repo', name: 'scan' },
      BASE_OPTS
    )
    expect(res.ok).toBe(true)
    expect(res.summary).toContain('all done')
    expect(res.rounds).toBe(1)

    const run = useSubagentRunsStore.getState().runs.find((r) => r.id === res.runId)
    expect(run).toBeDefined()
    expect(run!.status).toBe('ok')
    expect(run!.finishedAt).toBeTypeOf('number')
    expect(useSubagentRunsStore.getState().activeForSession('s1')).toHaveLength(0)
  })

  it('marks the run terminal when an unexpected error escapes the loop', async () => {
    // route() is called outside the per-attempt try/catch, so throwing there
    // propagates to the outer catch — the zombie-run fix under test.
    harness.route.mockImplementation(() => {
      throw new Error('boom')
    })
    const res = await runSubagent(
      { agent: 'explore', prompt: 'x', name: 'crash' },
      BASE_OPTS
    )
    expect(res.ok).toBe(false)
    expect(res.error).toContain('boom')

    const run = useSubagentRunsStore.getState().runs.find((r) => r.id === res.runId)
    expect(run!.status).toBe('error')
    expect(useSubagentRunsStore.getState().activeForSession('s1')).toHaveLength(0)
  })

  it('closes the subagent-opened panel only after the debounce window', async () => {
    vi.useFakeTimers()
    const close = vi.fn()
    ;(window as any).__subagentOpenedBrowserPanel = true
    ;(window as any).__closeRightPanel = close

    const res = await runSubagent({ agent: 'explore', prompt: 'x', name: 'p' }, BASE_OPTS)
    expect(res.ok).toBe(true)
    // Not closed immediately (sequential pipelines must not flicker).
    expect(close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3100)
    expect(close).toHaveBeenCalledTimes(1)
    expect((window as any).__subagentOpenedBrowserPanel).toBe(false)
  })

  it('cancels the pending panel close when a new run starts', async () => {
    vi.useFakeTimers()
    const close = vi.fn()
    ;(window as any).__subagentOpenedBrowserPanel = true
    ;(window as any).__closeRightPanel = close

    // Run 1 finishes → close armed.
    await runSubagent({ agent: 'explore', prompt: 'x', name: 'a' }, BASE_OPTS)

    // Run 2 starts and hangs mid-flight (its start() must cancel the arm).
    let release2: (v: unknown) => void = () => {}
    const gate = new Promise<unknown>((r) => {
      release2 = r
    })
    harness.callLLM.mockReturnValue(gate)
    const run2 = runSubagent({ agent: 'explore', prompt: 'y', name: 'b' }, BASE_OPTS)

    vi.advanceTimersByTime(3100)
    expect(close).not.toHaveBeenCalled()

    // Run 2 finishes → re-arms → closes after the window.
    release2(finalAnswer('done 2'))
    await run2
    vi.advanceTimersByTime(3100)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('mod SubagentStart / SubagentStop', () => {
  it('fires start before the first model call and stop with the result', async () => {
    const order: string[] = []
    harness.subStart.mockImplementation(() => order.push('start'))
    harness.callLLM.mockImplementation(async () => { order.push('llm'); return finalAnswer('the summary') })
    harness.subStop.mockImplementation(() => order.push('stop'))
    const r = await runSubagent({ name: 'scan', prompt: 'look around', agent: 'explore' } as never, BASE_OPTS)
    expect(order).toEqual(['start', 'llm', 'stop'])
    const start = harness.subStart.mock.calls[0][0]
    expect(start).toMatchObject({ sessionId: 's1', agent: 'explore', name: 'scan', prompt: 'look around', background: false })
    expect(start.runId).toBe(r.runId)
    expect(harness.subStop.mock.calls[0][0]).toMatchObject({ sessionId: 's1', runId: r.runId, agent: 'explore', status: 'ok' })
    expect(harness.subStop.mock.calls[0][0].summary).toContain('the summary')
  })

  it('reports error status when the run fails, and nothing for an empty prompt', async () => {
    harness.callLLM.mockRejectedValue(new Error('provider down'))
    const r = await runSubagent({ name: 'x', prompt: 'go', agent: 'explore' } as never, BASE_OPTS).catch((e) => e)
    expect(harness.subStop).toHaveBeenCalledTimes(1)
    expect(harness.subStop.mock.calls[0][0].status).toBe('error')
    expect(r).toBeDefined()
    harness.subStart.mockReset(); harness.subStop.mockReset()
    await runSubagent({ name: 'x', prompt: '  ', agent: 'explore' } as never, BASE_OPTS)
    expect(harness.subStart).not.toHaveBeenCalled()
    expect(harness.subStop).not.toHaveBeenCalled()
  })
})
