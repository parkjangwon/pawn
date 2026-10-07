import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isTrustedSender } from './trust'
import {
  autoLinkWiki,
  buildDigest,
  buildGraph,
  deletePage,
  findPage,
  getWikiSettings,
  lintWiki,
  listPages,
  renamePage,
  searchPages,
  setWikiSettings,
  tailLog,
  wikiDir,
  writePage
} from '../wiki'
import type { WikiScope, WikiSettings, WikiWriteInput } from '../wiki'

/** Wrap wiki handlers so an fs hiccup never crashes the main process. */
function handleWiki(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
  onError?: (err: unknown) => unknown
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender' }
    try {
      return await fn(event, ...(args as never[]))
    } catch (err) {
      console.error('[ipc] ' + channel + ' failed:', err)
      if (onError) return onError(err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function scopeOf(input: Record<string, unknown>): WikiScope {
  return input?.scope === 'project' ? 'project' : 'user'
}

function projectIdOf(input: Record<string, unknown>): string | null {
  const raw = input?.projectId ?? (input as Record<string, unknown>)?.project_id
  return raw != null && String(raw) !== '__general__' ? String(raw) : null
}

export function registerWikiIpc(): void {
  handleWiki('wiki:settings', () => getWikiSettings())

  handleWiki('wiki:setSettings', (_e, partial: Partial<WikiSettings>) => {
    return setWikiSettings(partial || {})
  })

  handleWiki('wiki:list', (_e, input: Record<string, unknown>) => {
    return listPages(scopeOf(input), projectIdOf(input), {
      query: input?.query != null ? String(input.query) : undefined,
      limit: input?.limit != null ? Number(input.limit) : undefined,
      offset: input?.offset != null ? Number(input.offset) : undefined
    })
  })

  handleWiki('wiki:read', (_e, input: Record<string, unknown>) => {
    const page = findPage(scopeOf(input), projectIdOf(input), String(input?.ref || ''))
    if (!page) return { ok: false, error: 'page not found' }
    return { ok: true, page }
  })

  handleWiki('wiki:write', (_e, input: Record<string, unknown>) => {
    return writePage({
      title: String(input?.title || ''),
      body: String(input?.body || ''),
      summary: input?.summary != null ? String(input.summary) : undefined,
      tags: Array.isArray(input?.tags) ? input.tags.map(String) : undefined,
      scope: scopeOf(input),
      projectId: projectIdOf(input)
    } satisfies WikiWriteInput)
  })

  handleWiki('wiki:delete', (_e, input: Record<string, unknown>) => {
    return deletePage(scopeOf(input), projectIdOf(input), String(input?.slug || ''))
  })

  handleWiki('wiki:rename', (_e, input: Record<string, unknown>) => {
    return renamePage(
      scopeOf(input),
      projectIdOf(input),
      String(input?.from || ''),
      String(input?.to || '')
    )
  })

  handleWiki('wiki:search', (_e, input: Record<string, unknown>) => {
    const scope = input?.scope === 'user' || input?.scope === 'project' ? input.scope : 'all'
    return searchPages({
      query: String(input?.query || ''),
      scope,
      projectId: projectIdOf(input),
      limit: input?.limit != null ? Number(input.limit) : undefined
    })
  })

  handleWiki('wiki:graph', (_e, input: Record<string, unknown>) => {
    return buildGraph(scopeOf(input), projectIdOf(input))
  })

  handleWiki('wiki:lint', (_e, input: Record<string, unknown>) => {
    return lintWiki(scopeOf(input), projectIdOf(input), { fix: input?.fix === true })
  })

  handleWiki('wiki:log', (_e, input: Record<string, unknown>) => {
    return tailLog(scopeOf(input), projectIdOf(input), input?.limit != null ? Number(input.limit) : 50)
  })

  handleWiki(
    'wiki:digest',
    (_e, opts: { projectId?: string | null }) => buildDigest({ projectId: opts?.projectId ?? null }),
    () => ''
  )

  handleWiki('wiki:autolink', (_e, input: Record<string, unknown>) => {
    const res = autoLinkWiki(scopeOf(input), projectIdOf(input))
    return res
  })

  handleWiki('wiki:stats', (_e, input: Record<string, unknown>) => {
    const scope = scopeOf(input)
    const projectId = projectIdOf(input)
    const pages = listPages(scope, projectId, { limit: 1 })
    const graph = buildGraph(scope, projectId)
    return { pages: pages.total, links: graph.edges.length, dir: wikiDir(scope, projectId) }
  })
}
