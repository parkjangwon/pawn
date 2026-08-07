import type { ToolHandler } from './types'


const memory_search: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.memory?.search) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const query = String(call.arguments.query || '').trim()
        if (!query) return { toolCallId: call.id, content: 'query is required', isError: true }
        const projectId = (await import('../../stores/app')).useAppStore.getState().activeProjectId
        const list = await api.memory.search({
          query,
          kind: call.arguments.kind ? String(call.arguments.kind) : undefined,
          scope: call.arguments.scope ? String(call.arguments.scope) : undefined,
          projectId: projectId && projectId !== '__general__' ? projectId : null,
          limit: call.arguments.limit != null ? Number(call.arguments.limit) : 8
        })
        if (!Array.isArray(list) || !list.length) {
          return { toolCallId: call.id, content: `No memories matched ${JSON.stringify(query)}.` }
        }
        const lines = list.map(
          (h: {
            id: string
            kind: string
            title: string
            content: string
            score?: number
            tags?: string[]
            pinned?: boolean
          }, i: number) =>
            `${i + 1}. [${h.kind}${h.pinned ? ', pinned' : ''}] ${h.title}\n   id: ${h.id}\n   ${h.content}${h.tags?.length ? `\n   tags: ${h.tags.join(', ')}` : ''}${h.score != null ? `\n   score: ${h.score}` : ''}`
        )
        return {
          toolCallId: call.id,
          content: `# Memory search: ${query}\nmatches=${list.length}\n\n${lines.join('\n\n')}`
        }
      }


const memory_save: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.memory?.save) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const content = String(call.arguments.content || '').trim()
        if (!content) return { toolCallId: call.id, content: 'content is required', isError: true }
        const projectId = (await import('../../stores/app')).useAppStore.getState().activeProjectId
        const scopeArg = call.arguments.scope ? String(call.arguments.scope) : undefined
        const scope =
          scopeArg === 'user' || scopeArg === 'project'
            ? scopeArg
            : projectId && projectId !== '__general__'
              ? 'project'
              : 'user'
        const res = await api.memory.save({
          content,
          title: call.arguments.title != null ? String(call.arguments.title) : undefined,
          kind: call.arguments.kind ? String(call.arguments.kind) : undefined,
          scope,
          projectId: scope === 'project' && projectId && projectId !== '__general__' ? projectId : null,
          tags: Array.isArray(call.arguments.tags) ? call.arguments.tags.map(String) : undefined,
          pinned: call.arguments.pinned === true,
          source: 'agent'
        })
        if (!res.ok) {
          return { toolCallId: call.id, content: res.error || 'Failed to save memory', isError: true }
        }
        const m = res.memory
        return {
          toolCallId: call.id,
          content: res.deduped
            ? `Memory already known (refreshed): ${m?.id}\n${m?.title}`
            : `Saved memory ${m?.id}\n[${m?.kind}] ${m?.title}\n${m?.content}`
        }
      }


const memory_list: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.memory?.list) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const projectId = (await import('../../stores/app')).useAppStore.getState().activeProjectId
        const res = await api.memory.list({
          query: call.arguments.query != null ? String(call.arguments.query) : undefined,
          kind: call.arguments.kind ? String(call.arguments.kind) : undefined,
          scope: call.arguments.scope ? String(call.arguments.scope) : undefined,
          projectId: projectId && projectId !== '__general__' ? projectId : null,
          limit: call.arguments.limit != null ? Number(call.arguments.limit) : 30
        })
        const items = res.items || []
        if (!items.length) return { toolCallId: call.id, content: 'No memories stored yet.' }
        const lines = items.map(
          (m: { id: string; kind: string; title: string; content: string; pinned?: boolean }, i: number) =>
            `${i + 1}. [${m.kind}${m.pinned ? ', pinned' : ''}] ${m.title}\n   id: ${m.id}\n   ${m.content.slice(0, 240)}`
        )
        return {
          toolCallId: call.id,
          content: `# Memories (total≈${res.total ?? items.length})\n\n${lines.join('\n\n')}`
        }
      }


const memory_forget: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.memory?.forget) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const id = String(call.arguments.id || '').trim()
        if (!id) return { toolCallId: call.id, content: 'id is required', isError: true }
        const res = await api.memory.forget(id)
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'Forget failed', isError: true }
        return { toolCallId: call.id, content: `Forgot memory ${id}` }
      }


const memory_update: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.memory?.update) {
          return { toolCallId: call.id, content: 'Memory is only available in the desktop app.', isError: true }
        }
        const id = String(call.arguments.id || '').trim()
        if (!id) return { toolCallId: call.id, content: 'id is required', isError: true }
        const res = await api.memory.update(id, {
          content: call.arguments.content != null ? String(call.arguments.content) : undefined,
          title: call.arguments.title != null ? String(call.arguments.title) : undefined,
          kind: call.arguments.kind != null ? String(call.arguments.kind) : undefined,
          tags: Array.isArray(call.arguments.tags) ? call.arguments.tags.map(String) : undefined,
          pinned: call.arguments.pinned as boolean | undefined,
          enabled: call.arguments.enabled as boolean | undefined
        })
        if (!res.ok) return { toolCallId: call.id, content: res.error || 'Update failed', isError: true }
        return {
          toolCallId: call.id,
          content: `Updated memory ${res.memory?.id}\n[${res.memory?.kind}] ${res.memory?.title}\n${res.memory?.content}`
        }
      }


const memory_consolidate: ToolHandler = async (call, projectPath, _signal, _ctx, api) => {
  if (!api.memory?.consolidate) {
    return {
      toolCallId: call.id,
      content: 'Memory consolidate is only available in the desktop app.',
      isError: true
    }
  }
  const projectId = (await import('../../stores/app')).useAppStore.getState().activeProjectId
  const res = await api.memory.consolidate({
    projectId: projectId && projectId !== '__general__' ? projectId : null,
    threshold: call.arguments.threshold != null ? Number(call.arguments.threshold) : undefined,
    dryRun: call.arguments.dry_run === true
  })
  if (!res?.ok) {
    return { toolCallId: call.id, content: 'Consolidate failed', isError: true }
  }
  const pairLines = (res.pairs || [])
    .slice(0, 20)
    .map(
      (p: { kept: string; dropped: string; score: number }) =>
        `- kept ${p.kept} ← dropped ${p.dropped} (score=${p.score})`
    )
  return {
    toolCallId: call.id,
    content: [
      `# Memory consolidate`,
      `examined: ${res.examined}`,
      `merged: ${res.merged}${call.arguments.dry_run === true ? ' (dry_run)' : ''}`,
      '',
      ...(pairLines.length ? pairLines : ['(no near-duplicates found)'])
    ].join('\n')
  }
}

export const memoryHandlers: Record<string, ToolHandler> = {
  memory_search,
  memory_save,
  memory_list,
  memory_forget,
  memory_update,
  memory_consolidate
}
