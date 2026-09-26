/**
 * Structured tool-call records.
 *
 * Tool rows used to be display strings (`[Tool: name] OK` + a `__DIFF__`
 * marker) that the UI re-parsed with regexes. ToolMeta is the structured
 * sidecar persisted next to each tool row (messages.tool_meta): what ran, on
 * what, whether it worked, how long it took, and how many lines it changed.
 * It powers one-line summaries now and per-turn analytics later.
 */

import type { ToolCall, ToolResult } from './toolDefinitionsTypes'
import { computeDiff } from '../utils/diff'

export interface ToolMeta {
  v: 1
  name: string
  status: 'ok' | 'error'
  /** Wall-clock execution time (permission prompts included). */
  durationMs?: number
  /** Primary argument: path, command, query, URL, … (clipped). */
  target?: string
  /** File the tool changed, when it changed one. */
  path?: string
  added?: number
  removed?: number
  /** Output size before truncation. */
  bytes?: number
}

const TARGET_MAX = 160
/** Above this, line stats are estimated instead of diffed (keeps the loop fast). */
const DIFF_STATS_MAX_CHARS = 400_000

const TARGET_KEYS = [
  'path',
  'file_path',
  'command',
  'query',
  'pattern',
  'url',
  'name',
  'repo',
  'agent',
  'topic',
  'job_id',
  'kind',
  'message',
  'text',
  'key',
  'id'
] as const

function clipTarget(v: string): string {
  const one = v.replace(/\s+/g, ' ').trim()
  return one.length > TARGET_MAX ? `${one.slice(0, TARGET_MAX - 1)}…` : one
}

export function primaryTarget(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined
  for (const k of TARGET_KEYS) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) return clipTarget(v)
    if (typeof v === 'number') return String(v)
  }
  if (Array.isArray(args.groups)) return clipTarget(args.groups.join(', '))
  if (Array.isArray(args.tasks)) return `${args.tasks.length} tasks`
  if (Array.isArray(args.items)) return `${args.items.length} items`
  return undefined
}

export function lineDelta(oldText: string, newText: string): { added: number; removed: number } {
  if (oldText === newText) return { added: 0, removed: 0 }
  if (!oldText) return { added: newText ? newText.split('\n').length : 0, removed: 0 }
  if (!newText) return { added: 0, removed: oldText.split('\n').length }
  if (oldText.length + newText.length > DIFF_STATS_MAX_CHARS) {
    const a = oldText.split('\n').length
    const b = newText.split('\n').length
    return { added: Math.max(0, b - a), removed: Math.max(0, a - b) }
  }
  const d = computeDiff(oldText, newText)
  return { added: d.added, removed: d.removed }
}

export function buildToolMeta(call: ToolCall, result: ToolResult, durationMs?: number): ToolMeta {
  const meta: ToolMeta = {
    v: 1,
    name: call.name,
    status: result.isError ? 'error' : 'ok'
  }
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
    meta.durationMs = Math.round(durationMs)
  }
  const target = primaryTarget(call.arguments)
  if (target) meta.target = target
  if (typeof result.content === 'string') meta.bytes = result.content.length
  if (result.diffData && !result.isError) {
    meta.path = result.diffData.path || result.diffData.filename
    const { added, removed } = lineDelta(result.diffData.oldText || '', result.diffData.newText || '')
    meta.added = added
    meta.removed = removed
  } else if (call.name === 'delete_file' && !result.isError && typeof call.arguments.path === 'string') {
    meta.path = call.arguments.path
  }
  return meta
}

export function serializeToolMeta(meta: ToolMeta): string {
  return JSON.stringify(meta)
}

export function parseToolMeta(raw: unknown): ToolMeta | undefined {
  if (!raw) return undefined
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  const m = obj as Partial<ToolMeta>
  if (!m || typeof m !== 'object' || typeof m.name !== 'string') return undefined
  if (m.status !== 'ok' && m.status !== 'error') return undefined
  return { ...m, v: 1 } as ToolMeta
}

/** "src/agent/router.ts" → "router.ts"; commands/queries unchanged. */
export function displayTarget(meta: Pick<ToolMeta, 'name' | 'target' | 'path'>): string | undefined {
  const t = meta.path || meta.target
  if (!t) return undefined
  const looksLikePath = /[\\/]/.test(t) && !/\s/.test(t) && !/^https?:/i.test(t)
  if (!looksLikePath) return t
  const parts = t.split(/[\\/]/).filter(Boolean)
  return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/')
}

export function formatToolDuration(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return undefined
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s ? `${m}m ${s}s` : `${m}m`
}

export type ToolKind = 'edit' | 'create' | 'delete' | 'read' | 'search' | 'shell' | 'git' | 'web' | 'browser' | 'agent' | 'other'

export function toolKind(name: string, meta?: Pick<ToolMeta, 'added' | 'removed'>): ToolKind {
  if (name === 'write_file') return meta && meta.removed === 0 && (meta.added ?? 0) > 0 ? 'create' : 'edit'
  if (name === 'edit_file') return 'edit'
  if (name === 'delete_file') return 'delete'
  if (name === 'read_file' || name === 'read_spreadsheet' || name === 'list_dir' || name === 'terminal_read') return 'read'
  if (/^(grep_search|search_files|codebase_search|repo_map|memory_search|lsp_)/.test(name)) return 'search'
  if (/^(shell_|run_checks)/.test(name)) return 'shell'
  if (name.startsWith('git_')) return 'git'
  if (name.startsWith('web_') || name === 'research_report') return 'web'
  if (name.startsWith('browser_') || name.startsWith('computer_')) return 'browser'
  if (/agent/.test(name)) return 'agent'
  return 'other'
}

export interface ToolBatchStats {
  total: number
  errors: number
  filesChanged: number
  added: number
  removed: number
  durationMs: number
  byKind: Partial<Record<ToolKind, number>>
}

/** Aggregate a batch of tool records for a one-line header. */
export function aggregateToolMeta(metas: Array<ToolMeta | undefined>): ToolBatchStats {
  const stats: ToolBatchStats = { total: 0, errors: 0, filesChanged: 0, added: 0, removed: 0, durationMs: 0, byKind: {} }
  const files = new Set<string>()
  for (const m of metas) {
    if (!m) continue
    stats.total++
    if (m.status === 'error') stats.errors++
    if (m.path && (m.added || m.removed || m.name === 'delete_file')) files.add(m.path)
    stats.added += m.added || 0
    stats.removed += m.removed || 0
    stats.durationMs += m.durationMs || 0
    const k = toolKind(m.name, m)
    stats.byKind[k] = (stats.byKind[k] || 0) + 1
  }
  stats.filesChanged = files.size
  return stats
}
