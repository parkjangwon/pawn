import { create } from 'zustand'

export type PermissionType = 'computer_use' | 'file_write' | 'file_read' | 'shell_exec' | 'browser' | 'app'

interface PermissionRequest {
  id: string
  type: PermissionType
  description: string
  details?: string
}

interface PermissionState {
  pending: PermissionRequest[]
  request: (req: Omit<PermissionRequest, 'id'>) => Promise<boolean>
  resolve: (id: string, approved: boolean) => void
}

const resolvers: Map<string, (approved: boolean) => void> = new Map()
let counter = 0

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pending: [],

  request: (req) => {
    return new Promise<boolean>((resolve) => {
      const id = `perm-${++counter}`
      resolvers.set(id, resolve)
      set((s) => ({ pending: [...s.pending, { ...req, id }] }))
    })
  },

  resolve: (id, approved) => {
    const resolver = resolvers.get(id)
    if (resolver) {
      resolver(approved)
      resolvers.delete(id)
    }
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
  }
}))
