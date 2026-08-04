import { create } from 'zustand'

/**
 * Bridge between chat/diff UI and the Files right-panel editor.
 * RightPanel opens the files tab; FilesView consumes pendingPath.
 */
interface FilesPanelState {
  pendingPath: string | null
  token: number
  openFile: (absPath: string) => void
  consume: () => string | null
}

export const useFilesPanelStore = create<FilesPanelState>((set, get) => ({
  pendingPath: null,
  token: 0,

  openFile: (absPath) => {
    if (!absPath || typeof absPath !== 'string') return
    set((s) => ({ pendingPath: absPath, token: s.token + 1 }))
    try {
      ;(window as unknown as { __openRightPanelTab?: (id: string) => void }).__openRightPanelTab?.('files')
    } catch {
      /* panel may not be mounted */
    }
  },

  consume: () => {
    const path = get().pendingPath
    if (path) set({ pendingPath: null })
    return path
  }
}))

export function openFileInPanel(absPath: string): void {
  useFilesPanelStore.getState().openFile(absPath)
}
