/**
 * Serial DB write queue with retries so a single flaky IPC does not lose
 * chat history / transcripts / ledger rows. Failures are retried with
 * exponential backoff; after exhausting retries the write is dropped and
 * logged (never throws into the UI path).
 */

type WriteJob = {
  label: string
  run: () => Promise<unknown>
}

const MAX_ATTEMPTS = 4
const BASE_DELAY_MS = 80

let chain: Promise<void> = Promise.resolve()
let pending = 0
let dropped = 0

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function enqueueDbWrite(label: string, run: () => Promise<unknown>): void {
  pending++
  chain = chain
    .then(async () => {
      let lastErr: unknown
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          await run()
          return
        } catch (err) {
          lastErr = err
          await sleep(BASE_DELAY_MS * (1 << attempt))
        }
      }
      dropped++
      console.warn(`[dbWriteQueue] dropped write after ${MAX_ATTEMPTS} attempts: ${label}`, lastErr)
    })
    .finally(() => {
      pending = Math.max(0, pending - 1)
    })
}

/** Test helpers */
export function __dbWriteQueueStats(): { pending: number; dropped: number } {
  return { pending, dropped }
}

export async function __flushDbWriteQueueForTests(): Promise<void> {
  await chain
}

export function __resetDbWriteQueueForTests(): void {
  chain = Promise.resolve()
  pending = 0
  dropped = 0
}
