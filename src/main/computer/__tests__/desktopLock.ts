/**
 * Interactive E2E tests take over the one real desktop (focus, mouse,
 * keyboard, launching and quitting apps). Vitest runs test files in parallel,
 * so files that drive the desktop serialize on this cross-process lock.
 */
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const LOCK = join(tmpdir(), 'pawn-cua-e2e.lock')
const STALE_MS = 5 * 60_000

function stale(): boolean {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8'))
    if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) return true
    if (pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0)
      } catch {
        return true // owner is gone
      }
    }
  } catch {
    /* raced with release */
  }
  return false
}

/** Wait for exclusive use of the desktop; returns the release function. */
export async function acquireDesktop(timeoutMs = 180_000): Promise<() => void> {
  const t0 = Date.now()
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      let released = false
      return () => {
        if (released) return
        released = true
        try {
          unlinkSync(LOCK)
        } catch {
          /* already gone */
        }
      }
    } catch {
      if (stale()) {
        try {
          unlinkSync(LOCK)
        } catch {
          /* someone else cleaned it */
        }
        continue
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for the desktop lock (${LOCK})`)
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}
