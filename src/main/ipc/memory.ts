import { ipcMain } from 'electron'
import {
  getMemorySettings,
  setMemorySettings,
  saveMemory,
  updateMemory,
  forgetMemory,
  forgetMany,
  clearMemories,
  searchMemories,
  listMemories,
  getMemory,
  stats,
  buildInjectBlock,
  ingestTurn,
  exportAll,
  importMany
} from '../memory'
import type { MemoryKind, MemoryScope, MemorySettings } from '../memory'

export function registerMemoryIpc(): void {
  ipcMain.handle('memory:settings', () => getMemorySettings())

  ipcMain.handle('memory:setSettings', (_e, partial: Partial<MemorySettings>) => {
    return setMemorySettings(partial || {})
  })

  ipcMain.handle('memory:save', (_e, input: Record<string, unknown>) => {
    return saveMemory({
      content: String(input?.content ?? ''),
      title: input?.title != null ? String(input.title) : undefined,
      kind: input?.kind as MemoryKind | undefined,
      scope: input?.scope as MemoryScope | undefined,
      projectId: input?.projectId != null ? String(input.projectId) : input?.project_id != null ? String(input.project_id) : null,
      tags: Array.isArray(input?.tags) ? input.tags.map(String) : undefined,
      source: (input?.source as 'user' | 'agent' | 'auto' | 'import') || 'agent',
      confidence: input?.confidence != null ? Number(input.confidence) : undefined,
      pinned: input?.pinned === true
    })
  })

  ipcMain.handle('memory:update', (_e, id: string, patch: Record<string, unknown>) => {
    return updateMemory(String(id), {
      content: patch?.content != null ? String(patch.content) : undefined,
      title: patch?.title != null ? String(patch.title) : undefined,
      kind: patch?.kind as MemoryKind | undefined,
      scope: patch?.scope as MemoryScope | undefined,
      projectId: patch?.projectId != null ? String(patch.projectId) : undefined,
      tags: Array.isArray(patch?.tags) ? patch.tags.map(String) : undefined,
      confidence: patch?.confidence != null ? Number(patch.confidence) : undefined,
      pinned: patch?.pinned as boolean | undefined,
      enabled: patch?.enabled as boolean | undefined
    })
  })

  ipcMain.handle('memory:forget', (_e, id: string) => forgetMemory(String(id)))

  ipcMain.handle('memory:forgetMany', (_e, ids: string[]) =>
    forgetMany(Array.isArray(ids) ? ids.map(String) : [])
  )

  ipcMain.handle(
    'memory:clear',
    (_e, opts?: { projectId?: string | null; scope?: MemoryScope }) => clearMemories(opts || {})
  )

  ipcMain.handle('memory:search', (_e, input: Record<string, unknown>) => {
    return searchMemories({
      query: String(input?.query ?? ''),
      projectId: input?.projectId != null ? String(input.projectId) : input?.project_id != null ? String(input.project_id) : null,
      kind: input?.kind as MemoryKind | undefined,
      scope: input?.scope as MemoryScope | undefined,
      limit: input?.limit != null ? Number(input.limit) : undefined,
      includeDisabled: input?.includeDisabled === true
    })
  })

  ipcMain.handle('memory:list', (_e, input?: Record<string, unknown>) => {
    return listMemories({
      projectId: input?.projectId != null ? String(input.projectId) : null,
      kind: input?.kind as MemoryKind | undefined,
      scope: input?.scope as MemoryScope | undefined,
      limit: input?.limit != null ? Number(input.limit) : undefined,
      offset: input?.offset != null ? Number(input.offset) : undefined,
      query: input?.query != null ? String(input.query) : undefined
    })
  })

  ipcMain.handle('memory:get', (_e, id: string) => getMemory(String(id)))

  ipcMain.handle('memory:stats', () => stats())

  ipcMain.handle(
    'memory:injectBlock',
    (_e, opts: { query?: string; projectId?: string | null }) =>
      buildInjectBlock({
        query: String(opts?.query || ''),
        projectId: opts?.projectId ?? null
      })
  )

  ipcMain.handle('memory:ingestTurn', (_e, input: {
    projectId?: string | null
    sessionId?: string
    messages?: Array<{ role: string; content: string }>
  }) =>
    ingestTurn({
      projectId: input?.projectId ?? null,
      sessionId: input?.sessionId,
      messages: Array.isArray(input?.messages) ? input.messages : []
    })
  )

  ipcMain.handle('memory:export', () => exportAll())

  ipcMain.handle('memory:import', (_e, items: unknown[], projectId?: string | null) => {
    const list = Array.isArray(items)
      ? items.map((it) => {
          const o = it as Record<string, unknown>
          return {
            content: String(o.content || ''),
            title: o.title != null ? String(o.title) : undefined,
            kind: o.kind as MemoryKind | undefined,
            scope: o.scope as MemoryScope | undefined,
            tags: Array.isArray(o.tags) ? o.tags.map(String) : undefined,
            source: 'import' as const,
            confidence: o.confidence != null ? Number(o.confidence) : 0.7,
            pinned: o.pinned === true
          }
        })
      : []
    return importMany(list, { projectId: projectId ?? null })
  })
}
