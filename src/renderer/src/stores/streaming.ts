import { create } from 'zustand'

/**
 * Live text of the assistant message currently streaming. Kept OUT of the app
 * store so per-token updates only re-render the one message row instead of
 * the whole projects tree.
 *
 * Updates are coalesced to one Zustand set per animation frame (in addition to
 * the LLM reader's own rAF) so multiple flush paths cannot thrash React.
 */
interface StreamingState {
  content: Record<string, string>
  setContent: (id: string, text: string) => void
  /** Immediate write (final flush) — bypasses rAF coalescing. */
  setContentNow: (id: string, text: string) => void
  clear: (id: string) => void
  /** Drop all live buffers (session switch / stop). */
  clearAll: () => void
}

const pending = new Map<string, string>()
let rafId: number | null = null

function scheduleFlush(apply: (patch: Record<string, string>) => void): void {
  if (rafId !== null) return
  const run = (): void => {
    rafId = null
    if (pending.size === 0) return
    const patch: Record<string, string> = {}
    for (const [id, text] of pending) patch[id] = text
    pending.clear()
    apply(patch)
  }
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(run)
  } else {
    run()
  }
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  content: {},

  setContent: (id, text) => {
    // Identical text → skip schedule entirely (avoids store notify).
    if (get().content[id] === text && !pending.has(id)) return
    if (pending.get(id) === text) return
    pending.set(id, text)
    scheduleFlush((patch) => {
      set((s) => {
        let changed = false
        const next = { ...s.content }
        for (const [pid, ptext] of Object.entries(patch)) {
          if (next[pid] !== ptext) {
            next[pid] = ptext
            changed = true
          }
        }
        return changed ? { content: next } : s
      })
    })
  },

  setContentNow: (id, text) => {
    pending.delete(id)
    set((s) => {
      if (s.content[id] === text) return s
      return { content: { ...s.content, [id]: text } }
    })
  },

  clear: (id) => {
    pending.delete(id)
    set((s) => {
      if (!(id in s.content)) return s
      const next = { ...s.content }
      delete next[id]
      return { content: next }
    })
  },

  clearAll: () => {
    pending.clear()
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    set({ content: {} })
  }
}))

/** Test helper — force pending rAF queue (jsdom has no rAF by default sometimes). */
export function __flushStreamingForTests(): void {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (pending.size === 0) return
  const patch: Record<string, string> = {}
  for (const [id, text] of pending) patch[id] = text
  pending.clear()
  useStreamingStore.setState((s) => {
    const next = { ...s.content, ...patch }
    return { content: next }
  })
}
