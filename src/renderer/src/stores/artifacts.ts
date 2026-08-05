import { create } from 'zustand'
import { uid } from '../utils/uid'

export type ArtifactKind = 'report' | 'file' | 'table' | 'note'

export interface Artifact {
  id: string
  title: string
  kind: ArtifactKind
  /** Absolute path when the deliverable is on disk. */
  path?: string
  /** Short plain-text preview (not full file body). */
  preview?: string
  source?: string
  createdAt: number
}

interface ArtifactsState {
  items: Artifact[]
  add: (input: Omit<Artifact, 'id' | 'createdAt'> & { id?: string }) => Artifact
  remove: (id: string) => void
  clear: () => void
}

const MAX_ITEMS = 80

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  items: [],

  add: (input) => {
    const item: Artifact = {
      id: input.id || uid('art'),
      title: input.title,
      kind: input.kind,
      path: input.path,
      preview: input.preview?.slice(0, 2000),
      source: input.source,
      createdAt: Date.now()
    }
    set((s) => ({
      items: [item, ...s.items].slice(0, MAX_ITEMS)
    }))
    return item
  },

  remove: (id) => set((s) => ({ items: s.items.filter((a) => a.id !== id) })),

  clear: () => set({ items: [] })
}))

/** Open the right panel on the artifacts tab (bridge registered by RightPanel). */
export function openArtifactsPanel(): void {
  try {
    ;(window as unknown as { __openRightPanelTab?: (id: string) => void }).__openRightPanelTab?.('artifacts')
  } catch { /* ignore */ }
}
