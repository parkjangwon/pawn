import { create } from 'zustand'

export type PermissionType = 'computer_use' | 'file_write' | 'file_read' | 'shell_exec' | 'browser' | 'app' | 'mcp'

export type AllowRule =
  | { id: string; kind: 'perm_type'; type: PermissionType; scope: 'session' | 'always' }
  | { id: string; kind: 'path_prefix'; prefix: string; scope: 'session' | 'always' }
  | { id: string; kind: 'shell_prefix'; prefix: string; scope: 'session' | 'always' }

interface PermissionRequest {
  id: string
  type: PermissionType
  description: string
  details?: string
  /** Absolute path for file tools when known */
  path?: string
  /** Shell command when known */
  command?: string
}

interface PermissionState {
  pending: PermissionRequest[]
  /** Types the user approved for the rest of this app run (not persisted). */
  sessionApproved: Set<PermissionType>
  /** Session-scoped path/shell rules (not persisted). */
  sessionRules: AllowRule[]
  /** Always rules (persisted to localStorage). */
  alwaysRules: AllowRule[]
  request: (req: Omit<PermissionRequest, 'id'>, signal?: AbortSignal) => Promise<boolean>
  resolve: (id: string, approved: boolean) => void
  approveSession: (type: PermissionType) => void
  addRule: (
    rule:
      | { kind: 'perm_type'; type: PermissionType; scope: 'session' | 'always' }
      | { kind: 'path_prefix'; prefix: string; scope: 'session' | 'always' }
      | { kind: 'shell_prefix'; prefix: string; scope: 'session' | 'always' }
  ) => void
  removeRule: (id: string) => void
  isAllowedByRules: (type: PermissionType, opts?: { path?: string; command?: string }) => boolean
}

interface PendingEntry {
  resolve: (approved: boolean) => void
  cleanup: () => void
}

const resolvers: Map<string, PendingEntry> = new Map()
let counter = 0
const ALWAYS_KEY = 'pawn-permission-always-rules'

function loadAlwaysRules(): AllowRule[] {
  try {
    const raw = localStorage.getItem(ALWAYS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAlwaysRules(rules: AllowRule[]): void {
  try {
    localStorage.setItem(ALWAYS_KEY, JSON.stringify(rules.filter((r) => r.scope === 'always')))
  } catch {
    /* ignore */
  }
}

function ruleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function matchPathPrefix(path: string, prefix: string): boolean {
  const p = path.replace(/\\/g, '/')
  const pre = prefix.replace(/\\/g, '/').replace(/\/$/, '')
  return p === pre || p.startsWith(pre + '/')
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pending: [],
  sessionApproved: new Set(),
  sessionRules: [],
  alwaysRules: typeof localStorage !== 'undefined' ? loadAlwaysRules() : [],

  request: (req, signal) => {
    return new Promise<boolean>((resolve) => {
      const id = `perm-${++counter}`
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
  },

  addRule: (rule) => {
    const full = { ...rule, id: ruleId() } as AllowRule
    if (full.scope === 'always') {
      set((s) => {
        const alwaysRules = [...s.alwaysRules, full]
        saveAlwaysRules(alwaysRules)
        return { alwaysRules }
      })
    } else {
      set((s) => ({ sessionRules: [...s.sessionRules, full] }))
      if (full.kind === 'perm_type') {
        get().approveSession(full.type)
      }
    }
  },

  removeRule: (id) => {
    set((s) => {
      const alwaysRules = s.alwaysRules.filter((r) => r.id !== id)
      const sessionRules = s.sessionRules.filter((r) => r.id !== id)
      saveAlwaysRules(alwaysRules)
      return { alwaysRules, sessionRules }
    })
  },

  isAllowedByRules: (type, opts) => {
    const { sessionApproved, sessionRules, alwaysRules } = get()
    if (sessionApproved.has(type)) return true
    const rules = [...alwaysRules, ...sessionRules]
    for (const rule of rules) {
      if (rule.kind === 'perm_type' && rule.type === type) return true
      if (rule.kind === 'path_prefix' && type === 'file_write' && opts?.path) {
        if (matchPathPrefix(opts.path, rule.prefix)) return true
      }
      if (rule.kind === 'shell_prefix' && type === 'shell_exec' && opts?.command) {
        const cmd = opts.command.trim()
        if (cmd === rule.prefix || cmd.startsWith(rule.prefix)) return true
      }
    }
    return false
  }
}))
