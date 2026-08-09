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
  /** Deny every pending prompt (Stop / session teardown). */
  denyAll: () => void
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

const MAX_PENDING = 24
/** Unattended / forgotten prompts must not block a turn forever. */
export const PERMISSION_TIMEOUT_MS = 3 * 60_000

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
      if (get().pending.length >= MAX_PENDING) {
        resolve(false)
        return
      }
      const id = `perm-${++counter}`
      let settled = false
      const finish = (approved: boolean): void => {
        if (settled) return
        settled = true
        resolve(approved)
      }
      function onAbort(): void {
        const entry = resolvers.get(id)
        entry?.cleanup()
        resolvers.delete(id)
        set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
        finish(false)
      }
      const timeoutId = setTimeout(() => {
        const entry = resolvers.get(id)
        if (!entry) return
        try {
          entry.cleanup()
        } catch {
          /* ignore */
        }
        resolvers.delete(id)
        set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
        finish(false)
      }, PERMISSION_TIMEOUT_MS)
      const cleanup = (): void => {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', onAbort)
      }
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeoutId)
          finish(false)
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      resolvers.set(id, { resolve: finish, cleanup })
      set((s) => ({ pending: [...s.pending, { ...req, id }] }))
    })
  },

  resolve: (id, approved) => {
    const entry = resolvers.get(id)
    if (!entry) {
      // Already resolved / aborted — drop a stale pending row if any.
      set((s) =>
        s.pending.some((p) => p.id === id)
          ? { pending: s.pending.filter((p) => p.id !== id) }
          : s
      )
      return
    }
    entry.cleanup()
    entry.resolve(approved)
    resolvers.delete(id)
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
  },

  denyAll: () => {
    const ids = Array.from(resolvers.keys())
    for (const id of ids) {
      const entry = resolvers.get(id)
      if (!entry) continue
      try {
        entry.cleanup()
        entry.resolve(false)
      } catch {
        /* ignore */
      }
      resolvers.delete(id)
    }
    set({ pending: [] })
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
