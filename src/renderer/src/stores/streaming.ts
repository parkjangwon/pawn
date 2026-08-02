import { create } from 'zustand'

/**
 * Live text of the assistant message currently streaming. Kept OUT of the app
 * store so per-token updates only re-render the one message row (and the
 * scroll effect) instead of replacing the whole projects tree 60x/sec.
 * Entries are cleared as soon as the final text is persisted.
 */
interface StreamingState {
  content: Record<string, string>
  setContent: (id: string, text: string) => void
  clear: (id: string) => void
}

export const useStreamingStore = create<StreamingState>((set) => ({
  content: {},

  setContent: (id, text) =>
    set((s) => ({ content: { ...s.content, [id]: text } })),

  clear: (id) =>
    set((s) => {
      if (!(id in s.content)) return s
      const next = { ...s.content }
      delete next[id]
      return { content: next }
    })
}))
