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
  /** Live reasoning / thinking channel (shown collapsed separately). */
  thinking: Record<string, string>
  setContent: (id: string, text: string) => void
  setThinking: (id: string, text: string) => void
  /** Immediate write (final flush) — bypasses rAF coalescing. */
  setContentNow: (id: string, text: string) => void
  setThinkingNow: (id: string, text: string) => void
  clear: (id: string) => void
  /** Drop all live buffers (session switch / stop). */
  clearAll: () => void
}

const pending = new Map<string, string>()
const pendingThinking = new Map<string, string>()
let rafId: number | null = null

function scheduleFlush(
  apply: (contentPatch: Record<string, string>, thinkingPatch: Record<string, string>) => void
): void {
  if (rafId !== null) return
  const run = (): void => {
    rafId = null
    if (pending.size === 0 && pendingThinking.size === 0) return
    const contentPatch: Record<string, string> = {}
    const thinkingPatch: Record<string, string> = {}
    for (const [id, text] of pending) contentPatch[id] = text
    for (const [id, text] of pendingThinking) thinkingPatch[id] = text
    pending.clear()
    pendingThinking.clear()
    apply(contentPatch, thinkingPatch)
  }
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(run)
  } else {
    run()
  }
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  content: {},
  thinking: {},

  setContent: (id, text) => {
    if (get().content[id] === text && !pending.has(id)) return
    if (pending.get(id) === text) return
    pending.set(id, text)
    scheduleFlush((contentPatch, thinkingPatch) => {
      set((s) => {
        let changed = false
        const nextC = { ...s.content }
        const nextT = { ...s.thinking }
        for (const [pid, ptext] of Object.entries(contentPatch)) {
          if (nextC[pid] !== ptext) {
            nextC[pid] = ptext
            changed = true
          }
        }
        for (const [pid, ptext] of Object.entries(thinkingPatch)) {
          if (nextT[pid] !== ptext) {
            nextT[pid] = ptext
            changed = true
          }
        }
        return changed ? { content: nextC, thinking: nextT } : s
      })
    })
  },

  setThinking: (id, text) => {
    if (get().thinking[id] === text && !pendingThinking.has(id)) return
    if (pendingThinking.get(id) === text) return
    pendingThinking.set(id, text)
    scheduleFlush((contentPatch, thinkingPatch) => {
      set((s) => {
        let changed = false
        const nextC = { ...s.content }
        const nextT = { ...s.thinking }
        for (const [pid, ptext] of Object.entries(contentPatch)) {
          if (nextC[pid] !== ptext) {
            nextC[pid] = ptext
            changed = true
          }
        }
        for (const [pid, ptext] of Object.entries(thinkingPatch)) {
          if (nextT[pid] !== ptext) {
            nextT[pid] = ptext
            changed = true
          }
        }
        return changed ? { content: nextC, thinking: nextT } : s
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

  setThinkingNow: (id, text) => {
    pendingThinking.delete(id)
    set((s) => {
      if (s.thinking[id] === text) return s
      return { thinking: { ...s.thinking, [id]: text } }
    })
  },

  clear: (id) => {
    pending.delete(id)
    pendingThinking.delete(id)
    set((s) => {
      const hasC = id in s.content
      const hasT = id in s.thinking
      if (!hasC && !hasT) return s
      const nextC = { ...s.content }
      const nextT = { ...s.thinking }
      delete nextC[id]
      delete nextT[id]
      return { content: nextC, thinking: nextT }
    })
  },

  clearAll: () => {
    pending.clear()
    pendingThinking.clear()
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    set({ content: {}, thinking: {} })
  }
}))

/** Test helper — force pending rAF queue (jsdom has no rAF by default sometimes). */
export function __flushStreamingForTests(): void {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (pending.size === 0 && pendingThinking.size === 0) return
  const contentPatch: Record<string, string> = {}
  const thinkingPatch: Record<string, string> = {}
  for (const [id, text] of pending) contentPatch[id] = text
  for (const [id, text] of pendingThinking) thinkingPatch[id] = text
  pending.clear()
  pendingThinking.clear()
  useStreamingStore.setState((s) => ({
    content: { ...s.content, ...contentPatch },
    thinking: { ...s.thinking, ...thinkingPatch }
  }))
}
