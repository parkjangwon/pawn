/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  useSubagentRunsStore,
  registerSubagentController,
  waitForSubagentRun
} from '../subagentRuns'

describe('subagentRuns store', () => {
  beforeEach(() => {
    useSubagentRunsStore.setState({ runs: [] })
  })

  it('tracks start/tick/finish', () => {
    useSubagentRunsStore.getState().start({
      id: 'r1',
      name: 'scan',
      agent: 'explore',
      parentSessionId: 's1',
      background: true
    })
    expect(useSubagentRunsStore.getState().activeForSession('s1')).toHaveLength(1)
    useSubagentRunsStore.getState().tick('r1', { rounds: 2, toolsUsed: ['read_file'] })
    useSubagentRunsStore.getState().finish('r1', {
      status: 'ok',
      summary: 'done',
      rounds: 2,
      toolsUsed: ['read_file']
    })
    const run = useSubagentRunsStore.getState().getById('r1')
    expect(run?.status).toBe('ok')
    expect(run?.summary).toBe('done')
    expect(useSubagentRunsStore.getState().activeForSession('s1')).toHaveLength(0)
  })

  it('cancel aborts controller and marks aborted', async () => {
    const c = new AbortController()
    registerSubagentController('r2', c)
    useSubagentRunsStore.getState().start({
      id: 'r2',
      name: 'w',
      agent: 'worker',
      parentSessionId: 's1'
    })
    const ok = useSubagentRunsStore.getState().cancel('r2')
    expect(ok).toBe(true)
    expect(c.signal.aborted).toBe(true)
    expect(useSubagentRunsStore.getState().getById('r2')?.status).toBe('aborted')
  })

  it('waitForSubagentRun resolves when finished', async () => {
    useSubagentRunsStore.getState().start({
      id: 'r3',
      name: 'x',
      agent: 'explore',
      parentSessionId: 's1'
    })
    const p = waitForSubagentRun('r3', 2000)
    setTimeout(() => {
      useSubagentRunsStore.getState().finish('r3', {
        status: 'ok',
        summary: 'hi',
        rounds: 1,
        toolsUsed: []
      })
    }, 20)
    const run = await p
    expect(run.summary).toBe('hi')
  })
})
