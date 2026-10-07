import type { ToolHandler } from './types'

interface PageMeta {
  slug: string
  title: string
  summary: string
  tags: string[]
  updated: string
  backlinks?: number
  links?: string[]
}

async function activeProjectId(): Promise<string | null> {
  const { useAppStore } = await import('../../stores/app')
  const id = useAppStore.getState().activeProjectId
  return id && id !== '__general__' ? id : null
}

/** Default scope: the active project when there is one, else the global wiki. */
async function defaultScope(
  scopeArg: unknown
): Promise<{ scope: 'user' | 'project'; projectId: string | null }> {
  const projectId = await activeProjectId()
  const scope = scopeArg === 'user' || scopeArg === 'project' ? scopeArg : projectId ? 'project' : 'user'
  return { scope, projectId: scope === 'project' ? projectId : null }
}

const wiki_search: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.wiki?.search) {
    return { toolCallId: call.id, content: 'The wiki is only available in the desktop app.', isError: true }
  }
  const query = String(call.arguments.query || '').trim()
  if (!query) return { toolCallId: call.id, content: 'query is required', isError: true }
  const projectId = await activeProjectId()
  const hits = await api.wiki.search({
    query,
    scope: call.arguments.scope ? String(call.arguments.scope) : 'all',
    projectId,
    limit: call.arguments.limit != null ? Number(call.arguments.limit) : 8
  })
  if (!hits.length) {
    return { toolCallId: call.id, content: 'No wiki pages matched ' + JSON.stringify(query) + '.' }
  }
  const lines = hits.map(
    (h, i) =>
      i +
      1 +
      '. [' +
      h.scope +
      '] ' +
      h.title +
      '\n   slug: ' +
      h.slug +
      '\n   ' +
      h.snippet +
      (h.tags?.length ? '\n   tags: ' + h.tags.join(', ') : '')
  )
  return {
    toolCallId: call.id,
    content: '# Wiki search: ' + query + '\nmatches=' + hits.length + '\n\n' + lines.join('\n\n')
  }
}

const wiki_read: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.wiki?.read) {
    return { toolCallId: call.id, content: 'The wiki is only available in the desktop app.', isError: true }
  }
  const ref = String(call.arguments.ref || '').trim()
  if (!ref) return { toolCallId: call.id, content: 'ref is required', isError: true }
  const projectId = await activeProjectId()
  const scopeArg = call.arguments.scope ? String(call.arguments.scope) : undefined
  const attempts: Array<{ scope?: string }> = scopeArg
    ? [{ scope: scopeArg }]
    : projectId
      ? [{ scope: 'project' }, { scope: 'user' }]
      : [{ scope: 'user' }]
  for (const attempt of attempts) {
    const res = await api.wiki.read({ ref, scope: attempt.scope, projectId })
    if (res.ok && res.page) {
      const p = res.page
      const meta =
        'slug: ' +
        p.slug +
        ' · updated: ' +
        (p.updated || '').slice(0, 10) +
        (p.tags?.length ? ' · tags: ' + p.tags.join(', ') : '')
      const tail = [
        p.links?.length ? 'Links out to: ' + p.links.join(', ') : 'Links out: none',
        'Backlinks: ' + (p.backlinks ? p.backlinks + ' page(s) link here' : 'none')
      ]
      return {
        toolCallId: call.id,
        content: '# ' + p.title + '\n' + meta + '\n\n' + p.body + '\n\n' + tail.join('\n')
      }
    }
  }
  return { toolCallId: call.id, content: 'No wiki page found for ' + JSON.stringify(ref) + '.' }
}

const wiki_list: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.wiki?.list) {
    return { toolCallId: call.id, content: 'The wiki is only available in the desktop app.', isError: true }
  }
  const projectId = await activeProjectId()
  const scopeArg = call.arguments.scope ? String(call.arguments.scope) : 'all'
  const perScope: Array<'user' | 'project'> =
    scopeArg === 'all'
      ? projectId
        ? ['project', 'user']
        : ['user']
      : [scopeArg === 'project' ? 'project' : 'user']
  const limit = call.arguments.limit != null ? Number(call.arguments.limit) : 30
  const query = call.arguments.query != null ? String(call.arguments.query) : undefined
  const sections: string[] = []
  let total = 0
  for (const scope of perScope) {
    const res = await api.wiki.list({
      scope,
      projectId: scope === 'project' ? projectId : null,
      query,
      limit
    })
    if (!res.items?.length) continue
    total += res.total
    const lines = res.items.map(
      (m, i) =>
        i +
        1 +
        '. ' +
        m.title +
        ' (slug: ' +
        m.slug +
        ')' +
        (m.tags?.length ? ' · tags: ' + m.tags.join(', ') : '') +
        '\n   ' +
        m.summary
    )
    sections.push('# ' + (scope === 'project' ? 'Project' : 'Global') + ' wiki (' + res.total + ' pages)\n\n' + lines.join('\n'))
  }
  if (!total) return { toolCallId: call.id, content: 'The wiki is empty so far.' }
  return { toolCallId: call.id, content: sections.join('\n\n') }
}

const wiki_write: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.wiki?.write) {
    return { toolCallId: call.id, content: 'The wiki is only available in the desktop app.', isError: true }
  }
  const title = String(call.arguments.title || '').trim()
  const body = String(call.arguments.body || '')
  if (!title) return { toolCallId: call.id, content: 'title is required', isError: true }
  if (!body.trim()) return { toolCallId: call.id, content: 'body is required', isError: true }
  const { scope, projectId } = await defaultScope(call.arguments.scope)
  const res = await api.wiki.write({
    title,
    body,
    summary: call.arguments.summary != null ? String(call.arguments.summary) : undefined,
    tags: Array.isArray(call.arguments.tags) ? call.arguments.tags.map(String) : undefined,
    scope,
    projectId
  })
  if (!res.ok) {
    return { toolCallId: call.id, content: res.error || 'Failed to write the wiki page', isError: true }
  }
  return {
    toolCallId: call.id,
    content:
      (res.created ? 'Created' : 'Updated') +
      ' wiki page ' +
      (res.page?.slug || title) +
      (res.page?.summary ? '\n' + res.page.summary : '') +
      '\nLinks out: ' +
      (res.page?.links?.length ? res.page.links.join(', ') : 'none') +
      ' · Backlinks: ' +
      (res.page?.backlinks || 0)
  }
}

const wiki_rename: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.wiki?.rename) {
    return { toolCallId: call.id, content: 'The wiki is only available in the desktop app.', isError: true }
  }
  const from = String(call.arguments.from || '').trim()
  const to = String(call.arguments.to || '').trim()
  if (!from || !to) return { toolCallId: call.id, content: 'from and to are required', isError: true }
  const { scope, projectId } = await defaultScope(call.arguments.scope)
  const res = await api.wiki.rename({ from, to, scope, projectId })
  if (!res.ok) return { toolCallId: call.id, content: res.error || 'Rename failed', isError: true }
  return {
    toolCallId: call.id,
    content:
      'Renamed to ' +
      (res.page?.title || to) +
      ' (slug: ' +
      (res.page?.slug || '') +
      '); rewrote links in ' +
      (res.rewritten || 0) +
      ' page(s).'
  }
}

const wiki_delete: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.wiki?.delete) {
    return { toolCallId: call.id, content: 'The wiki is only available in the desktop app.', isError: true }
  }
  const slug = String(call.arguments.slug || '').trim()
  if (!slug) return { toolCallId: call.id, content: 'slug is required', isError: true }
  const { scope, projectId } = await defaultScope(call.arguments.scope)
  const res = await api.wiki.delete({ slug, scope, projectId })
  if (!res.ok) return { toolCallId: call.id, content: res.error || 'Delete failed', isError: true }
  return { toolCallId: call.id, content: 'Deleted wiki page ' + slug }
}

const wiki_lint: ToolHandler = async (call, _projectPath, _signal, _ctx, api) => {
  if (!api.wiki?.lint) {
    return { toolCallId: call.id, content: 'The wiki is only available in the desktop app.', isError: true }
  }
  const { scope, projectId } = await defaultScope(call.arguments.scope)
  const res = await api.wiki.lint({ scope, projectId, fix: call.arguments.fix !== false })
  if (res.ok || !res.issues?.length) {
    return { toolCallId: call.id, content: '# Wiki lint\n' + res.pages + ' pages, no issues found.' }
  }
  const lines = res.issues.slice(0, 40).map((i) => '- [' + i.type + '] ' + i.slug + ': ' + i.detail)
  return {
    toolCallId: call.id,
    content:
      '# Wiki lint (' +
      res.issues.length +
      ' issues across ' +
      res.pages +
      ' pages)\nFix each with wiki_write / wiki_delete.\n\n' +
      lines.join('\n')
  }
}

export const wikiHandlers: Record<string, ToolHandler> = {
  wiki_search,
  wiki_read,
  wiki_list,
  wiki_write,
  wiki_rename,
  wiki_delete,
  wiki_lint
}
