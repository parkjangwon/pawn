/**
 * GitHub tools using local OAuth tokens (read + useful writes with repo scope).
 */

import { getGithubAccessToken } from './github'
import { clampInt, errMsg, fetchJson, truncate } from './http'

export type GithubToolResult = { ok: boolean; text: string; error?: string }

const UA = 'Pawn-Desktop'

async function tokenOrErr(): Promise<{ token: string } | GithubToolResult> {
  const token = getGithubAccessToken()
  if (!token) {
    return {
      ok: false,
      text: '',
      error: 'GitHub is not connected. Open Settings → Connections and connect GitHub first.'
    }
  }
  return { token }
}

function gh(path: string, token: string, init?: RequestInit & { raw?: boolean }) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`
  const headers: Record<string, string> = {
    Accept: init?.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  return fetchJson(url, {
    ...init,
    token,
    userAgent: UA,
    headers: { ...headers, ...(init?.headers as Record<string, string>) }
  })
}

function parseRepo(ownerRepo: string): { owner: string; repo: string } | null {
  const s = ownerRepo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const m = s.match(/^([^/]+)\/([^/#?]+)/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

export async function githubWhoami(): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const res = await gh('/user', t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'GitHub /user failed') }
  const u = res.body as { login?: string; name?: string; email?: string; html_url?: string; public_repos?: number }
  return {
    ok: true,
    text: truncate(
      [
        `GitHub user: ${u.login}`,
        `name: ${u.name || ''}`,
        `email: ${u.email || ''}`,
        `url: ${u.html_url || ''}`,
        `public_repos: ${u.public_repos ?? ''}`
      ].join('\n')
    )
  }
}

export async function githubListRepos(opts: {
  visibility?: string
  perPage?: number
  affiliation?: string
}): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const perPage = clampInt(opts.perPage, 20, 1, 50)
  const params = new URLSearchParams({
    per_page: String(perPage),
    sort: 'updated',
    direction: 'desc'
  })
  if (opts.visibility) params.set('visibility', opts.visibility)
  if (opts.affiliation) params.set('affiliation', opts.affiliation)
  const res = await gh(`/user/repos?${params}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list repos failed') }
  const repos = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(repos) || repos.length === 0) return { ok: true, text: 'No repositories' }
  const lines = repos.map((r) => {
    return [
      `- ${r.full_name}`,
      `  private: ${r.private}`,
      `  default_branch: ${r.default_branch}`,
      r.description ? `  desc: ${r.description}` : null,
      `  url: ${r.html_url}`,
      r.updated_at ? `  updated: ${r.updated_at}` : null
    ]
      .filter(Boolean)
      .join('\n')
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function githubGetRepo(ownerRepo: string): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(ownerRepo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const res = await gh(`/repos/${pr.owner}/${pr.repo}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'get repo failed') }
  const r = res.body as Record<string, unknown>
  return {
    ok: true,
    text: truncate(
      JSON.stringify(
        {
          full_name: r.full_name,
          description: r.description,
          private: r.private,
          default_branch: r.default_branch,
          language: r.language,
          stargazers_count: r.stargazers_count,
          open_issues_count: r.open_issues_count,
          html_url: r.html_url,
          clone_url: r.clone_url,
          pushed_at: r.pushed_at
        },
        null,
        2
      )
    )
  }
}

export async function githubListIssues(opts: {
  repo: string
  state?: string
  labels?: string
  perPage?: number
  pulls?: boolean
}): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(opts.repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const perPage = clampInt(opts.perPage, 20, 1, 50)
  const params = new URLSearchParams({
    state: opts.state || 'open',
    per_page: String(perPage),
    sort: 'updated',
    direction: 'desc'
  })
  if (opts.labels) params.set('labels', opts.labels)
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/issues?${params}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list issues failed') }
  let items = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(items)) items = []
  // GitHub issues API includes PRs; filter unless pulls requested
  if (!opts.pulls) items = items.filter((i) => !i.pull_request)
  else items = items.filter((i) => !!i.pull_request)
  if (items.length === 0) return { ok: true, text: `No ${opts.pulls ? 'pull requests' : 'issues'} found` }
  const lines = items.map((i) => {
    return [
      `- #${i.number} ${i.title}`,
      `  state: ${i.state}`,
      `  user: ${(i.user as { login?: string })?.login || ''}`,
      `  updated: ${i.updated_at}`,
      `  url: ${i.html_url}`,
      Array.isArray(i.labels) && i.labels.length
        ? `  labels: ${(i.labels as Array<{ name?: string }>).map((l) => l.name).join(', ')}`
        : null
    ]
      .filter(Boolean)
      .join('\n')
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function githubGetIssue(repo: string, number: number): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const num = clampInt(number, 0, 1, 1_000_000_000)
  if (!num) return { ok: false, text: '', error: 'number is required' }
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/issues/${num}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'get issue failed') }
  const i = res.body as Record<string, unknown>
  const comments = await gh(`/repos/${pr.owner}/${pr.repo}/issues/${num}/comments?per_page=20`, t.token)
  const citems = comments.ok ? ((comments.body as Array<Record<string, unknown>>) || []) : []
  const commentBlock = citems
    .map((c) => {
      return `### comment by ${(c.user as { login?: string })?.login}\n${c.body || ''}`
    })
    .join('\n\n')
  return {
    ok: true,
    text: truncate(
      [
        `#${i.number} ${i.title}`,
        `state: ${i.state}`,
        `user: ${(i.user as { login?: string })?.login}`,
        `url: ${i.html_url}`,
        i.pull_request ? 'type: pull_request' : 'type: issue',
        '',
        String(i.body || '(no body)'),
        commentBlock ? `\n## Comments\n\n${commentBlock}` : ''
      ].join('\n')
    )
  }
}

export async function githubListPulls(opts: {
  repo: string
  state?: string
  perPage?: number
}): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(opts.repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const perPage = clampInt(opts.perPage, 20, 1, 50)
  const params = new URLSearchParams({
    state: opts.state || 'open',
    per_page: String(perPage),
    sort: 'updated',
    direction: 'desc'
  })
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/pulls?${params}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list PRs failed') }
  const items = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(items) || items.length === 0) return { ok: true, text: 'No pull requests' }
  const lines = items.map((p) => {
    return [
      `- #${p.number} ${p.title}`,
      `  state: ${p.state}${p.draft ? ' (draft)' : ''}`,
      `  user: ${(p.user as { login?: string })?.login || ''}`,
      `  head: ${(p.head as { ref?: string })?.ref} → ${(p.base as { ref?: string })?.ref}`,
      `  url: ${p.html_url}`,
      `  updated: ${p.updated_at}`
    ].join('\n')
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function githubGetPull(repo: string, number: number): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const num = clampInt(number, 0, 1, 1_000_000_000)
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/pulls/${num}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'get PR failed') }
  const p = res.body as Record<string, unknown>
  const files = await gh(`/repos/${pr.owner}/${pr.repo}/pulls/${num}/files?per_page=50`, t.token)
  const fileList = files.ok ? ((files.body as Array<Record<string, unknown>>) || []) : []
  const fileLines = fileList
    .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions}) ${f.status}`)
    .join('\n')
  return {
    ok: true,
    text: truncate(
      [
        `PR #${p.number} ${p.title}`,
        `state: ${p.state}${p.merged ? ' merged' : ''}${p.draft ? ' draft' : ''}`,
        `user: ${(p.user as { login?: string })?.login}`,
        `head: ${(p.head as { label?: string })?.label} → ${(p.base as { label?: string })?.label}`,
        `url: ${p.html_url}`,
        `mergeable: ${p.mergeable}`,
        '',
        String(p.body || '(no body)'),
        fileLines ? `\n## Files\n${fileLines}` : ''
      ].join('\n')
    )
  }
}

export async function githubListCommits(opts: {
  repo: string
  sha?: string
  path?: string
  perPage?: number
}): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(opts.repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const perPage = clampInt(opts.perPage, 15, 1, 50)
  const params = new URLSearchParams({ per_page: String(perPage) })
  if (opts.sha) params.set('sha', opts.sha)
  if (opts.path) params.set('path', opts.path)
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/commits?${params}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'list commits failed') }
  const items = (res.body as Array<Record<string, unknown>>) || []
  if (!Array.isArray(items) || items.length === 0) return { ok: true, text: 'No commits' }
  const lines = items.map((c) => {
    const commit = c.commit as { message?: string; author?: { name?: string; date?: string } }
    const msg = (commit?.message || '').split('\n')[0]
    return `- ${String(c.sha).slice(0, 7)} ${msg}\n  author: ${commit?.author?.name || ''} @ ${commit?.author?.date || ''}`
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function githubGetFile(repo: string, path: string, ref?: string): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const p = path.replace(/^\//, '')
  if (!p) return { ok: false, text: '', error: 'path is required' }
  const url =
    `https://api.github.com/repos/${pr.owner}/${pr.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : '')
  const res = await fetchJson(url, {
    token: t.token,
    userAgent: UA,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  })
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'get file failed') }
  if (Array.isArray(res.body)) {
    const arr = res.body as Array<Record<string, unknown>>
    const lines = arr.map((e) => `- [${e.type}] ${e.name} (${e.path})`)
    return { ok: true, text: truncate(`Directory ${p}\n\n${lines.join('\n')}`) }
  }
  const body = res.body as {
    type?: string
    encoding?: string
    content?: string
    size?: number
    path?: string
  }
  if (body.encoding === 'base64' && body.content) {
    const text = Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8')
    return {
      ok: true,
      text: truncate(`# ${body.path || p}\nsize: ${body.size}\n\n${text}`)
    }
  }
  return { ok: true, text: truncate(JSON.stringify(body, null, 2)) }
}

export async function githubSearchCode(query: string, perPage = 10): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const q = query.trim()
  if (!q) return { ok: false, text: '', error: 'query is required' }
  const n = clampInt(perPage, 10, 1, 30)
  const res = await gh(
    `/search/code?${new URLSearchParams({ q, per_page: String(n) })}`,
    t.token,
    { headers: { Accept: 'application/vnd.github.text-match+json' } }
  )
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'code search failed') }
  const body = res.body as { total_count?: number; items?: Array<Record<string, unknown>> }
  const items = body.items || []
  if (items.length === 0) return { ok: true, text: `No code results for ${JSON.stringify(q)}` }
  const lines = items.map((it) => {
    const repo = (it.repository as { full_name?: string })?.full_name
    return `- ${repo}: ${it.path}\n  url: ${it.html_url}`
  })
  return { ok: true, text: truncate(`Code search total≈${body.total_count}\n\n${lines.join('\n')}`) }
}

export async function githubSearchIssues(query: string, perPage = 15): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const q = query.trim()
  if (!q) return { ok: false, text: '', error: 'query is required' }
  const n = clampInt(perPage, 15, 1, 30)
  const res = await gh(`/search/issues?${new URLSearchParams({ q, per_page: String(n) })}`, t.token)
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'issue search failed') }
  const body = res.body as { total_count?: number; items?: Array<Record<string, unknown>> }
  const items = body.items || []
  if (items.length === 0) return { ok: true, text: `No issues for ${JSON.stringify(q)}` }
  const lines = items.map((it) => {
    return `- ${it.repository_url ? String(it.repository_url).replace('api.github.com/repos/', '') : ''} #${it.number} ${it.title}\n  ${it.html_url}`
  })
  return { ok: true, text: truncate(`Issue search total≈${body.total_count}\n\n${lines.join('\n')}`) }
}

export async function githubCreateIssue(opts: {
  repo: string
  title: string
  body?: string
  labels?: string[]
}): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(opts.repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const title = opts.title.trim()
  if (!title) return { ok: false, text: '', error: 'title is required' }
  const payload: Record<string, unknown> = { title, body: opts.body || '' }
  if (opts.labels?.length) payload.labels = opts.labels
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/issues`, t.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'create issue failed') }
  const i = res.body as { number?: number; html_url?: string; title?: string }
  return { ok: true, text: `Created issue #${i.number}: ${i.title}\n${i.html_url}` }
}

export async function githubComment(opts: {
  repo: string
  number: number
  body: string
}): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(opts.repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  const num = clampInt(opts.number, 0, 1, 1_000_000_000)
  const body = opts.body.trim()
  if (!body) return { ok: false, text: '', error: 'body is required' }
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/issues/${num}/comments`, t.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  })
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'comment failed') }
  const c = res.body as { html_url?: string; id?: number }
  return { ok: true, text: `Comment posted on #${num}\n${c.html_url || `id=${c.id}`}` }
}

export async function githubCreatePull(opts: {
  repo: string
  title: string
  head: string
  base: string
  body?: string
  draft?: boolean
}): Promise<GithubToolResult> {
  const t = await tokenOrErr()
  if (!('token' in t)) return t
  const pr = parseRepo(opts.repo)
  if (!pr) return { ok: false, text: '', error: 'repo must be owner/name' }
  if (!opts.title.trim() || !opts.head.trim() || !opts.base.trim()) {
    return { ok: false, text: '', error: 'title, head, and base are required' }
  }
  const res = await gh(`/repos/${pr.owner}/${pr.repo}/pulls`, t.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body || '',
      draft: !!opts.draft
    })
  })
  if (!res.ok) return { ok: false, text: '', error: errMsg(res.status, res.body, 'create PR failed') }
  const p = res.body as { number?: number; html_url?: string; title?: string }
  return { ok: true, text: `Created PR #${p.number}: ${p.title}\n${p.html_url}` }
}

export type GithubToolName =
  | 'github_whoami'
  | 'github_list_repos'
  | 'github_get_repo'
  | 'github_list_issues'
  | 'github_get_issue'
  | 'github_list_pulls'
  | 'github_get_pull'
  | 'github_list_commits'
  | 'github_get_file'
  | 'github_search_code'
  | 'github_search_issues'
  | 'github_create_issue'
  | 'github_comment'
  | 'github_create_pull'

export async function runGithubTool(
  name: GithubToolName,
  args: Record<string, unknown>
): Promise<GithubToolResult> {
  switch (name) {
    case 'github_whoami':
      return githubWhoami()
    case 'github_list_repos':
      return githubListRepos({
        visibility: args.visibility ? String(args.visibility) : undefined,
        perPage: Number(args.per_page),
        affiliation: args.affiliation ? String(args.affiliation) : undefined
      })
    case 'github_get_repo':
      return githubGetRepo(String(args.repo ?? ''))
    case 'github_list_issues':
      return githubListIssues({
        repo: String(args.repo ?? ''),
        state: args.state ? String(args.state) : undefined,
        labels: args.labels ? String(args.labels) : undefined,
        perPage: Number(args.per_page),
        pulls: false
      })
    case 'github_get_issue':
      return githubGetIssue(String(args.repo ?? ''), Number(args.number))
    case 'github_list_pulls':
      return githubListPulls({
        repo: String(args.repo ?? ''),
        state: args.state ? String(args.state) : undefined,
        perPage: Number(args.per_page)
      })
    case 'github_get_pull':
      return githubGetPull(String(args.repo ?? ''), Number(args.number))
    case 'github_list_commits':
      return githubListCommits({
        repo: String(args.repo ?? ''),
        sha: args.sha ? String(args.sha) : undefined,
        path: args.path ? String(args.path) : undefined,
        perPage: Number(args.per_page)
      })
    case 'github_get_file':
      return githubGetFile(
        String(args.repo ?? ''),
        String(args.path ?? ''),
        args.ref ? String(args.ref) : undefined
      )
    case 'github_search_code':
      return githubSearchCode(String(args.query ?? ''), Number(args.per_page))
    case 'github_search_issues':
      return githubSearchIssues(String(args.query ?? ''), Number(args.per_page))
    case 'github_create_issue':
      return githubCreateIssue({
        repo: String(args.repo ?? ''),
        title: String(args.title ?? ''),
        body: args.body ? String(args.body) : undefined,
        labels: Array.isArray(args.labels) ? args.labels.map(String) : undefined
      })
    case 'github_comment':
      return githubComment({
        repo: String(args.repo ?? ''),
        number: Number(args.number),
        body: String(args.body ?? '')
      })
    case 'github_create_pull':
      return githubCreatePull({
        repo: String(args.repo ?? ''),
        title: String(args.title ?? ''),
        head: String(args.head ?? ''),
        base: String(args.base ?? ''),
        body: args.body ? String(args.body) : undefined,
        draft: args.draft === true
      })
    default:
      return { ok: false, text: '', error: `Unknown GitHub tool: ${name}` }
  }
}
