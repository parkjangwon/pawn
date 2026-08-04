import { create } from 'zustand'
import { setDisabledMcpServers, clearMcpToolCache } from '../agent/mcp'

export interface McpServerSummary {
  id: string
  source: McpServerSource
  status: 'connecting' | 'connected' | 'error'
  toolCount: number
  error?: string
  disabled: boolean
}

interface McpState {
  servers: McpServerSummary[]
  disabledIds: Set<string>
  loaded: boolean
  init: () => Promise<void>
  refresh: (projectPath?: string) => Promise<void>
  toggleServer: (id: string) => Promise<void>
  addServer: (
    scope: 'user' | 'project',
    projectPath: string | undefined,
    id: string,
    input: McpServerInput
  ) => Promise<{ ok: boolean; error?: string }>
  removeServer: (scope: 'user' | 'project', projectPath: string | undefined, id: string) => Promise<{ ok: boolean; error?: string }>
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  disabledIds: new Set(),
  loaded: false,

  init: async () => {
    if (get().loaded) return
    set({ loaded: true })
    try {
      const rawConfig = (await window.api.config.load()) as Record<string, unknown>
      const saved = (rawConfig as { settings?: { mcpDisabledServers?: unknown } }).settings?.mcpDisabledServers
      if (Array.isArray(saved)) {
        const ids = new Set(saved.filter((v): v is string => typeof v === 'string'))
        set({ disabledIds: ids })
        setDisabledMcpServers(ids)
      }
    } catch { /* use default (nothing disabled) */ }
  },

  refresh: async (projectPath) => {
    try {
      const rows = await window.api.mcp?.listTools?.(projectPath)
      if (!Array.isArray(rows)) return
      const disabled = get().disabledIds
      set({
        servers: rows.map((r) => ({
          id: r.id,
          source: r.source,
          status: r.status,
          toolCount: r.status === 'connected' ? r.tools.length : 0,
          error: r.status === 'error' ? r.error : undefined,
          disabled: disabled.has(r.id)
        }))
      })
    } catch { /* desktop-only feature */ }
  },

  toggleServer: async (id) => {
    const next = new Set(get().disabledIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({
      disabledIds: next,
      servers: get().servers.map((s) => (s.id === id ? { ...s, disabled: next.has(id) } : s))
    })
    setDisabledMcpServers(next)
    clearMcpToolCache()
    try {
      await window.api.config.save({ settings: { mcpDisabledServers: Array.from(next) } })
    } catch { /* best-effort persistence */ }
  },

  addServer: async (scope, projectPath, id, input) => {
    const res = await window.api.mcp?.addServer?.(scope, projectPath, id, input)
    if (!res) return { ok: false, error: 'MCP is not available in this environment.' }
    clearMcpToolCache()
    if (res.ok) await get().refresh(projectPath)
    return res
  },

  removeServer: async (scope, projectPath, id) => {
    const res = await window.api.mcp?.removeServer?.(scope, projectPath, id)
    if (!res) return { ok: false, error: 'MCP is not available in this environment.' }
    clearMcpToolCache()
    if (res.ok) await get().refresh(projectPath)
    return res
  }
}))
