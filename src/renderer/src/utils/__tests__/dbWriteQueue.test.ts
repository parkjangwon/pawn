/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  enqueueDbWrite,
  __flushDbWriteQueueForTests,
  __resetDbWriteQueueForTests,
  __dbWriteQueueStats
} from '../dbWriteQueue'

describe('dbWriteQueue', () => {
  beforeEach(() => {
    __resetDbWriteQueueForTests()
  })

  it('runs writes serially and retries failures', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ ok: true })
    enqueueDbWrite('t', fn)
    await __flushDbWriteQueueForTests()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(__dbWriteQueueStats().dropped).toBe(0)
  })

  it('drops after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'))
    enqueueDbWrite('t', fn)
    await __flushDbWriteQueueForTests()
    expect(fn).toHaveBeenCalledTimes(4)
    expect(__dbWriteQueueStats().dropped).toBe(1)
  })
})
