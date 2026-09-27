import { describe, it, expect } from 'vitest'
import { runCommand } from '../hooks/run'

describe('hook command stdin', () => {
  it('survives a hook that exits without reading its input (no unhandled EPIPE)', async () => {
    const unhandled: unknown[] = []
    const onErr = (e: unknown): void => void unhandled.push(e)
    process.on('uncaughtException', onErr)
    try {
      // 2 MB payload into a command that never reads stdin: the pipe breaks mid-write.
      const big = JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) })
      for (let i = 0; i < 5; i++) {
        const r = await runCommand('exit 0', big, { timeoutSec: 10, env: process.env })
        expect(r.code).toBe(0)
      }
      await new Promise((r) => setTimeout(r, 50))
      expect(unhandled).toEqual([])
    } finally {
      process.off('uncaughtException', onErr)
    }
  })
})
