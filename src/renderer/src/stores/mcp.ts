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
  /** Force spawn/connect (user Retry). */
  reconnect: (projectPath?: string) => Promise<void>
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
      // Snapshot first — never cold-start every server just because Settings opened.
      const statusApi = window.api.mcp?.status
      const listApi = window.api.mcp?.listTools
      let rows = statusApi ? await statusApi(projectPath) : null
      // If nothing is connected yet, fall back to full listTools (spawn).
      const anyLive =
        Array.isArray(rows) &&
        rows.some((r) => r.status === 'connected' || r.status === 'connecting')
      if ((!rows || !anyLive) && listApi) {
        rows = await listApi(projectPath)
      }
      if (!Array.isArray(rows)) return
      const disabled = get().disabledIds
      set({
        servers: rows.map((r) => ({
          id: r.id,
          source: r.source,
          status: r.status,
          toolCount:
            r.status === 'connected' && 'tools' in r && Array.isArray(r.tools)
              ? r.tools.length
              : r.status === 'connected' && 'toolCount' in r
                ? Number((r as { toolCount?: number }).toolCount) || 0
                : 0,
          error: r.status === 'error' ? r.error : undefined,
          disabled: disabled.has(r.id)
        }))
      })
    } catch { /* desktop-only feature */ }
  },

  /** Force reconnect: always listTools (may spawn). */
  reconnect: async (projectPath) => {
    try {
      const rows = await window.api.mcp?.listTools?.(projectPath)
      if (!Array.isArray(rows)) return
      const disabled = get().disabledIds
      set({
        servers: rows.map((r) => ({
          id: r.id,
          source: r.source,
          status: r.status,
          toolCount: r.status === 'connected' && 'tools' in r ? r.tools.length : 0,
          error: r.status === 'error' ? r.error : undefined,
          disabled: disabled.has(r.id)
        }))
      })
    } catch { /* optional */ }
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
