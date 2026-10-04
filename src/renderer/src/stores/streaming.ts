import { create } from 'zustand'

/**
 * Live output of a foreground shell command currently executing in a session.
 * Keyed by session id; never touches messages/transcripts (prompt-cache
 * stability). `jobId` identifies the producer so a late clear from one command
 * cannot drop another's card when two run in parallel.
 */
export interface LiveToolState {
  jobId: string
  /** Human label, e.g. "Run command". */
  label: string
  /** Primary argument, e.g. the command line or working directory. */
  target?: string
  startedAt: number
  /** Last few output lines. */
  tail: string
  totalLines: number
  totalChars: number
}

interface StreamingState {
  content: Record<string, string>
  /** Live reasoning / thinking channel (shown collapsed separately). */
  thinking: Record<string, string>
  /** Live action / tool execution status (e.g. "Reading auth.ts", "Running tests"). */
  activity: Record<string, string | null>
  /** Live tool output (streaming shell tail) keyed by session id. */
  liveTool: Record<string, LiveToolState>
  setContent: (id: string, text: string) => void
  setThinking: (id: string, text: string) => void
  setActivity: (id: string, text: string | null) => void
  setLiveTool: (sessionId: string, state: LiveToolState) => void
  /** Clears only when `jobId` still owns the slot (parallel-safe). */
  clearLiveTool: (sessionId: string, jobId: string) => void
  /** Immediate write (final flush) — bypasses rAF coalescing. */
  setContentNow: (id: string, text: string) => void
  setThinkingNow: (id: string, text: string) => void
  setActivityNow: (id: string, text: string | null) => void
  clear: (id: string) => void
  /** Drop all live buffers (session switch / stop). */
  clearAll: () => void
}

const pending = new Map<string, string>()
const pendingThinking = new Map<string, string>()
const pendingActivity = new Map<string, string | null>()
let rafId: number | null = null

function scheduleFlush(
  apply: (
    contentPatch: Record<string, string>,
    thinkingPatch: Record<string, string>,
    activityPatch: Record<string, string | null>
  ) => void
): void {
  if (rafId !== null) return
  const run = (): void => {
    rafId = null
    if (pending.size === 0 && pendingThinking.size === 0 && pendingActivity.size === 0) return
    const contentPatch: Record<string, string> = {}
    const thinkingPatch: Record<string, string> = {}
    const activityPatch: Record<string, string | null> = {}
    for (const [id, text] of pending) contentPatch[id] = text
    for (const [id, text] of pendingThinking) thinkingPatch[id] = text
    for (const [id, act] of pendingActivity) activityPatch[id] = act
    pending.clear()
    pendingThinking.clear()
    pendingActivity.clear()
    apply(contentPatch, thinkingPatch, activityPatch)
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
  activity: {},
  liveTool: {},

  setContent: (id, text) => {
    if (get().content[id] === text && !pending.has(id)) return
    if (pending.get(id) === text) return
    pending.set(id, text)
    scheduleFlush((contentPatch, thinkingPatch, activityPatch) => {
      set((s) => {
        let changed = false
        const nextC = { ...s.content }
        const nextT = { ...s.thinking }
        const nextA = { ...s.activity }
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
        for (const [pid, pact] of Object.entries(activityPatch)) {
          if (nextA[pid] !== pact) {
            if (pact === null) delete nextA[pid]
            else nextA[pid] = pact
            changed = true
          }
        }
        return changed ? { content: nextC, thinking: nextT, activity: nextA } : s
      })
    })
  },

  setThinking: (id, text) => {
    if (get().thinking[id] === text && !pendingThinking.has(id)) return
    if (pendingThinking.get(id) === text) return
    pendingThinking.set(id, text)
    scheduleFlush((contentPatch, thinkingPatch, activityPatch) => {
      set((s) => {
        let changed = false
        const nextC = { ...s.content }
        const nextT = { ...s.thinking }
        const nextA = { ...s.activity }
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
        for (const [pid, pact] of Object.entries(activityPatch)) {
          if (nextA[pid] !== pact) {
            if (pact === null) delete nextA[pid]
            else nextA[pid] = pact
            changed = true
          }
        }
        return changed ? { content: nextC, thinking: nextT, activity: nextA } : s
      })
    })
  },

  setActivity: (id, text) => {
    if (get().activity[id] === text && !pendingActivity.has(id)) return
    pendingActivity.set(id, text)
    scheduleFlush((contentPatch, thinkingPatch, activityPatch) => {
      set((s) => {
        let changed = false
        const nextC = { ...s.content }
        const nextT = { ...s.thinking }
        const nextA = { ...s.activity }
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
        for (const [pid, pact] of Object.entries(activityPatch)) {
          if (nextA[pid] !== pact) {
            if (pact === null) delete nextA[pid]
            else nextA[pid] = pact
            changed = true
          }
        }
        return changed ? { content: nextC, thinking: nextT, activity: nextA } : s
      })
    })
  },

  // Live tool output polls a few times a second — write straight through
  // (no rAF coalescing needed at that rate, and the card is the only subscriber).
  setLiveTool: (sessionId, state) => {
    set((s) => {
      const cur = s.liveTool[sessionId]
      if (
        cur &&
        cur.jobId === state.jobId &&
        cur.tail === state.tail &&
        cur.totalLines === state.totalLines &&
        cur.totalChars === state.totalChars
      ) {
        return s
      }
      return { liveTool: { ...s.liveTool, [sessionId]: state } }
    })
  },

  clearLiveTool: (sessionId, jobId) => {
    set((s) => {
      if (s.liveTool[sessionId]?.jobId !== jobId) return s
      const next = { ...s.liveTool }
      delete next[sessionId]
      return { liveTool: next }
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

  setActivityNow: (id, text) => {
    pendingActivity.delete(id)
    set((s) => {
      const nextA = { ...s.activity }
      if (text === null) delete nextA[id]
      else nextA[id] = text
      return { activity: nextA }
    })
  },

  clear: (id) => {
    pending.delete(id)
    pendingThinking.delete(id)
    pendingActivity.delete(id)
    set((s) => {
      const hasC = id in s.content
      const hasT = id in s.thinking
      const hasA = id in s.activity
      if (!hasC && !hasT && !hasA) return s
      const nextC = { ...s.content }
      const nextT = { ...s.thinking }
      const nextA = { ...s.activity }
      delete nextC[id]
      delete nextT[id]
      delete nextA[id]
      return { content: nextC, thinking: nextT, activity: nextA }
    })
  },

  clearAll: () => {
    pending.clear()
    pendingThinking.clear()
    pendingActivity.clear()
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    set({ content: {}, thinking: {}, activity: {}, liveTool: {} })
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
