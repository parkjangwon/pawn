/**
 * GitLab tools using a local Personal Access Token (self-hosted or gitlab.com).
 */

import { getGitlabConfig } from './gitlab'
import { clampInt, errMsg, truncate } from './http'

export type GitlabToolResult = { ok: boolean; text: string; error?: string }

const UA = 'Pawn-Desktop'

async function cfgOrErr(): Promise<{ token: string; baseUrl: string } | GitlabToolResult> {
  const cfg = getGitlabConfig()
  if (!cfg) {
    return {
      ok: false,
      text: '',
      error:
        'GitLab is not connected. Open Settings → Connections and connect GitLab with a personal access token.'
    }
  }
  return cfg
}

async function gl(
  path: string,
  cfg: { token: string; baseUrl: string },
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = path.startsWith('http') ? path : `${cfg.baseUrl}/api/v4${path}`
  const headers = new Headers(init?.headers || {})
  headers.set('PRIVATE-TOKEN', cfg.token)
  headers.set('Accept', 'application/json')
  headers.set('User-Agent', UA)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, { ...init, headers })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  }
  const text = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, body: { text } }
}

/** project id or URL-encoded path (group%2Fproject) */
function projectPath(repo: string): string {
  const s = repo
    .trim()
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/\.git$/, '')
    .replace(/^\//, '')
  if (/^\d+$/.test(s)) return s
  return encodeURIComponent(s)
}

export async function gitlabWhoami(): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const res = await gl('/user', c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'GitLab /user failed') }
  const u = res.body as {
    username?: string
    name?: string
    email?: string
    web_url?: string
    public_email?: string
  }
  return {
    ok: true,
    text: truncate(
      [
        `GitLab user: ${u.username}`,
        `name: ${u.name || ''}`,
        `email: ${u.email || u.public_email || ''}`,
        `url: ${u.web_url || ''}`,
        `host: ${c.baseUrl}`
      ].join('\n')
    )
  }
}

export async function gitlabListProjects(opts: {
  membership?: boolean
  search?: string
  perPage?: number
}): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const perPage = clampInt(opts.perPage, 20, 1, 50)
  const params = new URLSearchParams({
    per_page: String(perPage),
    order_by: 'last_activity_at',
    sort: 'desc',
    simple: 'true'
  })
  if (opts.membership !== false) params.set('membership', 'true')
  if (opts.search) params.set('search', opts.search)
  const res = await gl(`/projects?${params}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list projects failed') }
  const projects = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(projects) || projects.length === 0) return { ok: true, text: 'No projects' }
  const lines = projects.map((p) => {
    return [
      `- ${p.path_with_namespace || p.name}`,
      `  id: ${p.id}`,
      `  visibility: ${p.visibility}`,
      `  default_branch: ${p.default_branch || ''}`,
      p.description ? `  desc: ${p.description}` : null,
      `  url: ${p.web_url}`,
      p.last_activity_at ? `  updated: ${p.last_activity_at}` : null
    ]
      .filter(Boolean)
      .join('\n')
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function gitlabGetProject(repo: string): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(repo)
  if (!id) return { ok: false, text: '', error: 'project is required (id or group/name)' }
  const res = await gl(`/projects/${id}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'get project failed') }
  const p = res.body as Record<string, unknown>
  return {
    ok: true,
    text: truncate(
      JSON.stringify(
        {
          id: p.id,
          path_with_namespace: p.path_with_namespace,
          description: p.description,
          visibility: p.visibility,
          default_branch: p.default_branch,
          web_url: p.web_url,
          http_url_to_repo: p.http_url_to_repo,
          ssh_url_to_repo: p.ssh_url_to_repo,
          open_issues_count: p.open_issues_count,
          last_activity_at: p.last_activity_at
        },
        null,
        2
      )
    )
  }
}

export async function gitlabListIssues(opts: {
  project: string
  state?: string
  labels?: string
  perPage?: number
}): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(opts.project)
  if (!id) return { ok: false, text: '', error: 'project is required' }
  const perPage = clampInt(opts.perPage, 20, 1, 50)
  const params = new URLSearchParams({
    state: opts.state || 'opened',
    per_page: String(perPage),
    order_by: 'updated_at',
    sort: 'desc'
  })
  if (opts.labels) params.set('labels', opts.labels)
  const res = await gl(`/projects/${id}/issues?${params}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list issues failed') }
  const items = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(items) || items.length === 0) return { ok: true, text: 'No issues found' }
  const lines = items.map((i) => {
    return [
      `- #${i.iid} ${i.title}`,
      `  state: ${i.state}`,
      `  author: ${(i.author as { username?: string })?.username || ''}`,
      `  updated: ${i.updated_at}`,
      `  url: ${i.web_url}`,
      Array.isArray(i.labels) && i.labels.length ? `  labels: ${(i.labels as string[]).join(', ')}` : null
    ]
      .filter(Boolean)
      .join('\n')
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function gitlabGetIssue(project: string, iid: number): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(project)
  const num = clampInt(iid, 0, 1, 1_000_000_000)
  if (!id || !num) return { ok: false, text: '', error: 'project and iid are required' }
  const res = await gl(`/projects/${id}/issues/${num}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'get issue failed') }
  const i = res.body as Record<string, unknown>
  const notes = await gl(`/projects/${id}/issues/${num}/notes?per_page=20&sort=asc`, c)
  const nitems = notes.ok ? ((notes.body as Array<Record<string, unknown>>) || []) : []
  const commentBlock = nitems
    .filter((n) => !n.system)
    .map((n) => `### note by ${(n.author as { username?: string })?.username}\n${n.body || ''}`)
    .join('\n\n')
  return {
    ok: true,
    text: truncate(
      [
        `#${i.iid} ${i.title}`,
        `state: ${i.state}`,
        `author: ${(i.author as { username?: string })?.username}`,
        `url: ${i.web_url}`,
        '',
        String(i.description || '(no body)'),
        commentBlock ? `\n## Notes\n\n${commentBlock}` : ''
      ].join('\n')
    )
  }
}

export async function gitlabListMergeRequests(opts: {
  project: string
  state?: string
  perPage?: number
}): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(opts.project)
  if (!id) return { ok: false, text: '', error: 'project is required' }
  const perPage = clampInt(opts.perPage, 20, 1, 50)
  const params = new URLSearchParams({
    state: opts.state || 'opened',
    per_page: String(perPage),
    order_by: 'updated_at',
    sort: 'desc'
  })
  const res = await gl(`/projects/${id}/merge_requests?${params}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list MRs failed') }
  const items = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(items) || items.length === 0) return { ok: true, text: 'No merge requests' }
  const lines = items.map((m) => {
    return [
      `- !${m.iid} ${m.title}`,
      `  state: ${m.state}${m.draft || m.work_in_progress ? ' (draft)' : ''}`,
      `  author: ${(m.author as { username?: string })?.username || ''}`,
      `  source: ${m.source_branch} → ${m.target_branch}`,
      `  url: ${m.web_url}`,
      `  updated: ${m.updated_at}`
    ].join('\n')
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function gitlabGetMergeRequest(
  project: string,
  iid: number
): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(project)
  const num = clampInt(iid, 0, 1, 1_000_000_000)
  if (!id || !num) return { ok: false, text: '', error: 'project and iid are required' }
  const res = await gl(`/projects/${id}/merge_requests/${num}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'get MR failed') }
  const m = res.body as Record<string, unknown>
  const changes = await gl(`/projects/${id}/merge_requests/${num}/changes`, c)
  const changeList =
    changes.ok &&
    Array.isArray((changes.body as { changes?: unknown[] })?.changes)
      ? ((changes.body as { changes: Array<Record<string, unknown>> }).changes || [])
      : []
  const fileLines = changeList
    .slice(0, 50)
    .map((f) => `- ${f.new_path || f.old_path} ${f.new_file ? '(new)' : f.deleted_file ? '(deleted)' : ''}`)
    .join('\n')
  return {
    ok: true,
    text: truncate(
      [
        `MR !${m.iid} ${m.title}`,
        `state: ${m.state}${m.merge_status ? ` merge_status=${m.merge_status}` : ''}`,
        `author: ${(m.author as { username?: string })?.username}`,
        `source: ${m.source_branch} → ${m.target_branch}`,
        `url: ${m.web_url}`,
        '',
        String(m.description || '(no body)'),
        fileLines ? `\n## Changed files\n${fileLines}` : ''
      ].join('\n')
    )
  }
}

export async function gitlabListCommits(opts: {
  project: string
  ref?: string
  path?: string
  perPage?: number
}): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(opts.project)
  if (!id) return { ok: false, text: '', error: 'project is required' }
  const perPage = clampInt(opts.perPage, 15, 1, 50)
  const params = new URLSearchParams({ per_page: String(perPage) })
  if (opts.ref) params.set('ref_name', opts.ref)
  if (opts.path) params.set('path', opts.path)
  const res = await gl(`/projects/${id}/repository/commits?${params}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list commits failed') }
  const items = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(items) || items.length === 0) return { ok: true, text: 'No commits' }
  const lines = items.map((cm) => {
    const msg = String(cm.title || cm.message || '').split('\n')[0]
    return `- ${String(cm.short_id || String(cm.id).slice(0, 7))} ${msg}\n  author: ${cm.author_name || ''} @ ${cm.authored_date || cm.created_at || ''}`
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function gitlabGetFile(
  project: string,
  path: string,
  ref?: string
): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(project)
  const p = path.replace(/^\//, '')
  if (!id || !p) return { ok: false, text: '', error: 'project and path are required' }
  const params = new URLSearchParams()
  if (ref) params.set('ref', ref)
  const q = params.toString() ? `?${params}` : ''
  const filePath = encodeURIComponent(p)
  const res = await gl(`/projects/${id}/repository/files/${filePath}${q}`, c)
  if (res.ok) {
    const body = res.body as {
      file_path?: string
      size?: number
      encoding?: string
      content?: string
      ref?: string
    }
    if (body.encoding === 'base64' && body.content) {
      const text = Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8')
      return {
        ok: true,
        text: truncate(`# ${body.file_path || p}\nsize: ${body.size}\nref: ${body.ref || ref || ''}\n\n${text}`)
      }
    }
    return { ok: true, text: truncate(JSON.stringify(body, null, 2)) }
  }
  // Maybe directory — list tree
  const treeParams = new URLSearchParams({ path: p, per_page: '50' })
  if (ref) treeParams.set('ref', ref)
  const tree = await gl(`/projects/${id}/repository/tree?${treeParams}`, c)
  if (tree.ok && Array.isArray(tree.body)) {
    const arr = tree.body as Array<Record<string, unknown>>
    const lines = arr.map((e) => `- [${e.type}] ${e.name} (${e.path})`)
    return { ok: true, text: truncate(`Directory ${p}\n\n${lines.join('\n')}`) }
  }
  return { ok: false, text: '', error: errMsg(res.status, res.body, 'get file failed') }
}

export async function gitlabSearch(query: string, scope = 'projects', perPage = 15): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const q = query.trim()
  if (!q) return { ok: false, text: '', error: 'query is required' }
  const n = clampInt(perPage, 15, 1, 30)
  const sc = ['projects', 'issues', 'merge_requests', 'blobs', 'commits'].includes(scope)
    ? scope
    : 'projects'
  const params = new URLSearchParams({
    scope: sc,
    search: q,
    per_page: String(n)
  })
  const res = await gl(`/search?${params}`, c)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'search failed') }
  const items = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: true, text: `No ${sc} results for ${JSON.stringify(q)}` }
  }
  const lines = items.map((it) => {
    if (sc === 'projects') {
      return `- ${it.path_with_namespace || it.name}\n  ${it.web_url || ''}`
    }
    if (sc === 'issues' || sc === 'merge_requests') {
      return `- ${it.references ? JSON.stringify(it.references) : ''} ${it.title}\n  ${it.web_url || ''}`
    }
    if (sc === 'blobs') {
      return `- ${it.project_id}: ${it.path || it.filename}\n  ${it.data ? String(it.data).slice(0, 120) : ''}`
    }
    return `- ${JSON.stringify(it).slice(0, 200)}`
  })
  return { ok: true, text: truncate(`Search (${sc}) results\n\n${lines.join('\n')}`) }
}

export async function gitlabCreateIssue(opts: {
  project: string
  title: string
  body?: string
  labels?: string[]
}): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(opts.project)
  const title = opts.title.trim()
  if (!id || !title) return { ok: false, text: '', error: 'project and title are required' }
  const payload: Record<string, unknown> = {
    title,
    description: opts.body || ''
  }
  if (opts.labels?.length) payload.labels = opts.labels.join(',')
  const res = await gl(`/projects/${id}/issues`, c, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'create issue failed') }
  const i = res.body as { iid?: number; web_url?: string; title?: string }
  return { ok: true, text: `Created issue #${i.iid}: ${i.title}\n${i.web_url}` }
}

export async function gitlabComment(opts: {
  project: string
  iid: number
  body: string
  type?: 'issue' | 'merge_request'
}): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(opts.project)
  const num = clampInt(opts.iid, 0, 1, 1_000_000_000)
  const body = opts.body.trim()
  if (!id || !num || !body) {
    return { ok: false, text: '', error: 'project, iid, and body are required' }
  }
  const kind = opts.type === 'merge_request' ? 'merge_requests' : 'issues'
  const res = await gl(`/projects/${id}/${kind}/${num}/notes`, c, {
    method: 'POST',
    body: JSON.stringify({ body })
  })
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'comment failed') }
  const n = res.body as { id?: number; body?: string }
  return { ok: true, text: `Comment posted on ${kind} #${num} (note id=${n.id})` }
}

export async function gitlabCreateMergeRequest(opts: {
  project: string
  title: string
  sourceBranch: string
  targetBranch: string
  body?: string
  draft?: boolean
}): Promise<GitlabToolResult> {
  const c = await cfgOrErr()
  if (!('token' in c)) return c
  const id = projectPath(opts.project)
  if (!id || !opts.title.trim() || !opts.sourceBranch.trim() || !opts.targetBranch.trim()) {
    return { ok: false, text: '', error: 'project, title, source_branch, and target_branch are required' }
  }
  let title = opts.title.trim()
  if (opts.draft && !/^draft:/i.test(title) && !/^wip:/i.test(title)) {
    title = `Draft: ${title}`
  }
  const res = await gl(`/projects/${id}/merge_requests`, c, {
    method: 'POST',
    body: JSON.stringify({
      title,
      source_branch: opts.sourceBranch,
      target_branch: opts.targetBranch,
      description: opts.body || ''
    })
  })
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'create MR failed') }
  const m = res.body as { iid?: number; web_url?: string; title?: string }
  return { ok: true, text: `Created MR !${m.iid}: ${m.title}\n${m.web_url}` }
}

export type GitlabToolName =
  | 'gitlab_whoami'
  | 'gitlab_list_projects'
  | 'gitlab_get_project'
  | 'gitlab_list_issues'
  | 'gitlab_get_issue'
  | 'gitlab_list_merge_requests'
  | 'gitlab_get_merge_request'
  | 'gitlab_list_commits'
  | 'gitlab_get_file'
  | 'gitlab_search'
  | 'gitlab_create_issue'
  | 'gitlab_comment'
  | 'gitlab_create_merge_request'

export async function runGitlabTool(
  name: GitlabToolName,
  args: Record<string, unknown>
): Promise<GitlabToolResult> {
  switch (name) {
    case 'gitlab_whoami':
      return gitlabWhoami()
    case 'gitlab_list_projects':
      return gitlabListProjects({
        membership: args.membership !== false,
        search: args.search ? String(args.search) : undefined,
        perPage: Number(args.per_page)
      })
    case 'gitlab_get_project':
      return gitlabGetProject(String(args.project ?? args.repo ?? ''))
    case 'gitlab_list_issues':
      return gitlabListIssues({
        project: String(args.project ?? args.repo ?? ''),
        state: args.state ? String(args.state) : undefined,
        labels: args.labels ? String(args.labels) : undefined,
        perPage: Number(args.per_page)
      })
    case 'gitlab_get_issue':
      return gitlabGetIssue(String(args.project ?? args.repo ?? ''), Number(args.iid ?? args.number))
    case 'gitlab_list_merge_requests':
      return gitlabListMergeRequests({
        project: String(args.project ?? args.repo ?? ''),
        state: args.state ? String(args.state) : undefined,
        perPage: Number(args.per_page)
      })
    case 'gitlab_get_merge_request':
      return gitlabGetMergeRequest(
        String(args.project ?? args.repo ?? ''),
        Number(args.iid ?? args.number)
      )
    case 'gitlab_list_commits':
      return gitlabListCommits({
        project: String(args.project ?? args.repo ?? ''),
        ref: args.ref ? String(args.ref) : args.sha ? String(args.sha) : undefined,
        path: args.path ? String(args.path) : undefined,
        perPage: Number(args.per_page)
      })
    case 'gitlab_get_file':
      return gitlabGetFile(
        String(args.project ?? args.repo ?? ''),
        String(args.path ?? ''),
        args.ref ? String(args.ref) : undefined
      )
    case 'gitlab_search':
      return gitlabSearch(
        String(args.query ?? ''),
        args.scope ? String(args.scope) : 'projects',
        Number(args.per_page)
      )
    case 'gitlab_create_issue':
      return gitlabCreateIssue({
        project: String(args.project ?? args.repo ?? ''),
        title: String(args.title ?? ''),
        body: args.body ? String(args.body) : args.description ? String(args.description) : undefined,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : undefined
      })
    case 'gitlab_comment':
      return gitlabComment({
        project: String(args.project ?? args.repo ?? ''),
        iid: Number(args.iid ?? args.number),
        body: String(args.body ?? ''),
        type: args.type === 'merge_request' ? 'merge_request' : 'issue'
      })
    case 'gitlab_create_merge_request':
      return gitlabCreateMergeRequest({
        project: String(args.project ?? args.repo ?? ''),
        title: String(args.title ?? ''),
        sourceBranch: String(args.source_branch ?? args.head ?? ''),
        targetBranch: String(args.target_branch ?? args.base ?? ''),
        body: args.body ? String(args.body) : args.description ? String(args.description) : undefined,
        draft: args.draft === true
      })
    default:
      return { ok: false, text: '', error: `Unknown GitLab tool: ${name}` }
  }
}
