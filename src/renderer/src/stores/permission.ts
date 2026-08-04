import { create } from 'zustand'

export type PermissionType = 'computer_use' | 'file_write' | 'file_read' | 'shell_exec' | 'browser' | 'app' | 'mcp'

interface PermissionRequest {
  id: string
  type: PermissionType
  description: string
  details?: string
}

interface PermissionState {
  pending: PermissionRequest[]
  /** Types the user approved for the rest of this app run (not persisted). */
  sessionApproved: Set<PermissionType>
  request: (req: Omit<PermissionRequest, 'id'>, signal?: AbortSignal) => Promise<boolean>
  resolve: (id: string, approved: boolean) => void
  approveSession: (type: PermissionType) => void
}

interface PendingEntry {
  resolve: (approved: boolean) => void
  cleanup: () => void
}

const resolvers: Map<string, PendingEntry> = new Map()
let counter = 0

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pending: [],
  sessionApproved: new Set(),

  request: (req, signal) => {
    return new Promise<boolean>((resolve) => {
      const id = `perm-${++counter}`
      // Abort (Stop button, steer) auto-denies the request so the agent loop
      // can never hang forever in front of an unanswered dialog.
      function onAbort(): void {
        resolvers.delete(id)
        set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
        resolve(false)
      }
      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort)
      }
      if (signal) {
        if (signal.aborted) {
          resolve(false)
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      resolvers.set(id, { resolve, cleanup })
      set((s) => ({ pending: [...s.pending, { ...req, id }] }))
    })
  },

  resolve: (id, approved) => {
    const entry = resolvers.get(id)
    if (entry) {
      entry.cleanup()
      entry.resolve(approved)
      resolvers.delete(id)
    }
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
  },

  approveSession: (type) => {
    set((s) => ({ sessionApproved: new Set(s.sessionApproved).add(type) }))
  }
}))
