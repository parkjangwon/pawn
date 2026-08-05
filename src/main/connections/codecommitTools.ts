/**
 * AWS CodeCommit tools using stored IAM credentials (SigV4).
 */

import { getCodeCommitCredentials } from './codecommit'
import { codecommitApi, stsGetCallerIdentity } from './awsSign'
import { clampInt, truncate } from './http'

export type CodeCommitToolResult = { ok: boolean; text: string; error?: string }

function credsOrErr():
  | { ok: true; creds: NonNullable<ReturnType<typeof getCodeCommitCredentials>> }
  | CodeCommitToolResult {
  const creds = getCodeCommitCredentials()
  if (!creds) {
    return {
      ok: false,
      text: '',
      error:
        'CodeCommit is not connected. Open Settings → Connections and connect with AWS access key credentials.'
    }
  }
  return { ok: true, creds }
}

function awsErr(status: number, body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const msg =
      (typeof b.message === 'string' && b.message) ||
      (typeof b.Message === 'string' && b.Message) ||
      (typeof b.__type === 'string' && b.__type)
    if (msg) return `${fallback} (${status}): ${msg}`
  }
  return `${fallback} (${status})`
}

export async function codecommitWhoami(): Promise<CodeCommitToolResult> {
  const c = credsOrErr()
  if (!('creds' in c)) return c
  const id = await stsGetCallerIdentity(c.creds)
  if (!id.ok) {
    return {
      ok: true,
      text: truncate(
        [
          `CodeCommit region: ${c.creds.region}`,
          `access_key_id: ${c.creds.accessKeyId.slice(0, 8)}…`,
          id.error ? `sts: ${id.error}` : 'sts: unavailable'
        ].join('\n')
      )
    }
  }
  return {
    ok: true,
    text: truncate(
      [
        `CodeCommit identity`,
        `arn: ${id.arn || ''}`,
        `account: ${id.account || ''}`,
        `userId: ${id.userId || ''}`,
        `region: ${c.creds.region}`
      ].join('\n')
    )
  }
}

export async function codecommitListRepos(opts: {
  nextToken?: string
  maxResults?: number
}): Promise<CodeCommitToolResult> {
  const c = credsOrErr()
  if (!('creds' in c)) return c
  const maxResults = clampInt(opts.maxResults, 25, 1, 100)
  const payload: Record<string, unknown> = { maxResults }
  if (opts.nextToken) payload.nextToken = opts.nextToken
  const res = await codecommitApi(c.creds, 'ListRepositories', payload)
  if (!res.ok) {
    return { ok: false, text: '', error: awsErr(res.status, res.body, 'list repos failed') }
  }
  const body = res.body as {
    repositories?: Array<{ repositoryName?: string; repositoryId?: string }>
    nextToken?: string
  }
  const repos = body.repositories || []
  if (repos.length === 0) return { ok: true, text: 'No CodeCommit repositories' }
  const lines = repos.map(
    (r) =>
      `- ${r.repositoryName}\n  id: ${r.repositoryId || ''}\n  clone: https://git-codecommit.${c.creds.region}.amazonaws.com/v1/repos/${r.repositoryName}`
  )
  const more = body.nextToken ? `\n\nnextToken: ${body.nextToken}` : ''
  return { ok: true, text: truncate(lines.join('\n') + more) }
}

export async function codecommitGetRepo(repositoryName: string): Promise<CodeCommitToolResult> {
  const c = credsOrErr()
  if (!('creds' in c)) return c
  const name = repositoryName.trim()
  if (!name) return { ok: false, text: '', error: 'repository_name is required' }
  const res = await codecommitApi(c.creds, 'GetRepository', { repositoryName: name })
  if (!res.ok) return { ok: false, text: '', error: awsErr(res.status, res.body, 'get repo failed') }
  const meta = (res.body as { repositoryMetadata?: Record<string, unknown> }).repositoryMetadata || {}
  return {
    ok: true,
    text: truncate(
      JSON.stringify(
        {
          repositoryName: meta.repositoryName,
          repositoryId: meta.repositoryId,
          defaultBranch: meta.defaultBranch,
          cloneUrlHttp: meta.cloneUrlHttp,
          cloneUrlSsh: meta.cloneUrlSsh,
          creationDate: meta.creationDate,
          lastModifiedDate: meta.lastModifiedDate,
          Arn: meta.Arn,
          region: c.creds.region
        },
        null,
        2
      )
    )
  }
}

export async function codecommitListBranches(opts: {
  repositoryName: string
  nextToken?: string
}): Promise<CodeCommitToolResult> {
  const c = credsOrErr()
  if (!('creds' in c)) return c
  const name = opts.repositoryName.trim()
  if (!name) return { ok: false, text: '', error: 'repository_name is required' }
  const payload: Record<string, unknown> = { repositoryName: name }
  if (opts.nextToken) payload.nextToken = opts.nextToken
  const res = await codecommitApi(c.creds, 'ListBranches', payload)
  if (!res.ok) {
    return { ok: false, text: '', error: awsErr(res.status, res.body, 'list branches failed') }
  }
  const body = res.body as { branches?: string[]; nextToken?: string }
  const branches = body.branches || []
  if (branches.length === 0) return { ok: true, text: 'No branches' }
  const lines = branches.map((b) => `- ${b}`)
  const more = body.nextToken ? `\n\nnextToken: ${body.nextToken}` : ''
  return { ok: true, text: truncate(lines.join('\n') + more) }
}

export async function codecommitGetBranch(
  repositoryName: string,
  branchName: string
): Promise<CodeCommitToolResult> {
  const c = credsOrErr()
  if (!('creds' in c)) return c
  const repo = repositoryName.trim()
  const branch = branchName.trim()
  if (!repo || !branch) {
    return { ok: false, text: '', error: 'repository_name and branch_name are required' }
  }
  const res = await codecommitApi(c.creds, 'GetBranch', {
    repositoryName: repo,
    branchName: branch
  })
  if (!res.ok) return { ok: false, text: '', error: awsErr(res.status, res.body, 'get branch failed') }
  const b = (res.body as { branch?: Record<string, unknown> }).branch || {}
  return {
    ok: true,
    text: truncate(
      JSON.stringify(
        {
          branchName: b.branchName,
          commitId: b.commitId
        },
        null,
        2
      )
    )
  }
}

export async function codecommitListCommits(opts: {
  repositoryName: string
  branchName?: string
  commitSpecifier?: string
  maxResults?: number
}): Promise<CodeCommitToolResult> {
  const c = credsOrErr()
  if (!('creds' in c)) return c
  const name = opts.repositoryName.trim()
  if (!name) return { ok: false, text: '', error: 'repository_name is required' }

  let commitSpecifier = opts.commitSpecifier?.trim()
  if (!commitSpecifier) {
    const branch = opts.branchName?.trim() || 'main'
    const br = await codecommitApi(c.creds, 'GetBranch', {
      repositoryName: name,
      branchName: branch
    })
    if (!br.ok) {
      // try master
      if (branch === 'main') {
        const br2 = await codecommitApi(c.creds, 'GetBranch', {
          repositoryName: name,
          branchName: 'master'
        })
        if (br2.ok) {
          commitSpecifier =
            ((br2.body as { branch?: { commitId?: string } }).branch?.commitId) || ''
        }
      }
      if (!commitSpecifier) {
        // fallback: default branch from repo metadata
        const repo = await codecommitApi(c.creds, 'GetRepository', { repositoryName: name })
        const def =
          (repo.body as { repositoryMetadata?: { defaultBranch?: string } })?.repositoryMetadata
            ?.defaultBranch
        if (def) {
          const br3 = await codecommitApi(c.creds, 'GetBranch', {
            repositoryName: name,
            branchName: def
          })
          commitSpecifier =
            ((br3.body as { branch?: { commitId?: string } }).branch?.commitId) || ''
        }
      }
      if (!commitSpecifier) {
        return {
          ok: false,
          text: '',
          error: awsErr(br.status, br.body, 'could not resolve branch tip — pass commit_specifier or branch_name')
        }
      }
    } else {
      commitSpecifier =
        ((br.body as { branch?: { commitId?: string } }).branch?.commitId) || ''
    }
  }

  const maxResults = clampInt(opts.maxResults, 15, 1, 50)
  // GetCommit for tip + walk parents lightly via GetDifferences is heavy;
  // use GetCommit on tip and list parent commits if available.
  const tip = await codecommitApi(c.creds, 'GetCommit', {
    repositoryName: name,
    commitId: commitSpecifier
  })
  if (!tip.ok) {
    return { ok: false, text: '', error: awsErr(tip.status, tip.body, 'get commit failed') }
  }

  const commits: Array<Record<string, unknown>> = []
  let current = (tip.body as { commit?: Record<string, unknown> }).commit
  let count = 0
  while (current && count < maxResults) {
    commits.push(current)
    count++
    const parents = (current.parents as string[] | undefined) || []
    if (!parents.length) break
    const parentRes = await codecommitApi(c.creds, 'GetCommit', {
      repositoryName: name,
      commitId: parents[0]
    })
    if (!parentRes.ok) break
    current = (parentRes.body as { commit?: Record<string, unknown> }).commit
  }

  if (commits.length === 0) return { ok: true, text: 'No commits' }
  const lines = commits.map((cm) => {
    const msg = String(cm.message || '').split('\n')[0]
    const author = (cm.author as { name?: string; date?: string }) || {}
    return `- ${String(cm.commitId || '').slice(0, 7)} ${msg}\n  author: ${author.name || ''} @ ${author.date || ''}`
  })
  return { ok: true, text: truncate(lines.join('\n')) }
}

export async function codecommitGetFile(opts: {
  repositoryName: string
  filePath: string
  commitSpecifier?: string
}): Promise<CodeCommitToolResult> {
  const c = credsOrErr()
  if (!('creds' in c)) return c
  const name = opts.repositoryName.trim()
  const filePath = opts.filePath.replace(/^\//, '').trim()
  if (!name || !filePath) {
    return { ok: false, text: '', error: 'repository_name and file_path are required' }
  }
  const payload: Record<string, unknown> = {
    repositoryName: name,
    filePath
  }
  if (opts.commitSpecifier) payload.commitSpecifier = opts.commitSpecifier

  const res = await codecommitApi(c.creds, 'GetFile', payload)
  if (res.ok) {
    const body = res.body as {
      filePath?: string
      fileSize?: number
      fileMode?: string
      fileContent?: string
      commitId?: string
      blobId?: string
    }
    // fileContent is base64
    let text = ''
    if (body.fileContent) {
      try {
        text = Buffer.from(body.fileContent, 'base64').toString('utf8')
      } catch {
        text = '(binary or undecodable content)'
      }
    }
    return {
      ok: true,
      text: truncate(
        `# ${body.filePath || filePath}\nsize: ${body.fileSize}\ncommit: ${body.commitId || ''}\n\n${text}`
      )
    }
  }

  // Try folder listing
  const folder = await codecommitApi(c.creds, 'GetFolder', {
    repositoryName: name,
    folderPath: filePath || '/',
    ...(opts.commitSpecifier ? { commitSpecifier: opts.commitSpecifier } : {})
  })
  if (folder.ok) {
    const fb = folder.body as {
      files?: Array<{ absolutePath?: string; relativePath?: string }>
      subFolders?: Array<{ absolutePath?: string; relativePath?: string }>
      tree?: Array<{ absolutePath?: string }>
    }
    const lines: string[] = []
    for (const f of fb.files || []) {
      lines.push(`- [file] ${f.absolutePath || f.relativePath}`)
    }
    for (const d of fb.subFolders || []) {
      lines.push(`- [dir] ${d.absolutePath || d.relativePath}`)
    }
    if (lines.length === 0) {
      return { ok: true, text: `Folder ${filePath} is empty` }
    }
    return { ok: true, text: truncate(`Directory ${filePath}\n\n${lines.join('\n')}`) }
  }

  return { ok: false, text: '', error: awsErr(res.status, res.body, 'get file failed') }
}

export type CodeCommitToolName =
  | 'codecommit_whoami'
  | 'codecommit_list_repos'
  | 'codecommit_get_repo'
  | 'codecommit_list_branches'
  | 'codecommit_get_branch'
  | 'codecommit_list_commits'
  | 'codecommit_get_file'

export async function runCodeCommitTool(
  name: CodeCommitToolName,
  args: Record<string, unknown>
): Promise<CodeCommitToolResult> {
  switch (name) {
    case 'codecommit_whoami':
      return codecommitWhoami()
    case 'codecommit_list_repos':
      return codecommitListRepos({
        nextToken: args.next_token ? String(args.next_token) : undefined,
        maxResults: Number(args.max_results ?? args.per_page)
      })
    case 'codecommit_get_repo':
      return codecommitGetRepo(String(args.repository_name ?? args.repo ?? ''))
    case 'codecommit_list_branches':
      return codecommitListBranches({
        repositoryName: String(args.repository_name ?? args.repo ?? ''),
        nextToken: args.next_token ? String(args.next_token) : undefined
      })
    case 'codecommit_get_branch':
      return codecommitGetBranch(
        String(args.repository_name ?? args.repo ?? ''),
        String(args.branch_name ?? args.branch ?? '')
      )
    case 'codecommit_list_commits':
      return codecommitListCommits({
        repositoryName: String(args.repository_name ?? args.repo ?? ''),
        branchName: args.branch_name
          ? String(args.branch_name)
          : args.branch
            ? String(args.branch)
            : undefined,
        commitSpecifier: args.commit_specifier
          ? String(args.commit_specifier)
          : args.sha
            ? String(args.sha)
            : undefined,
        maxResults: Number(args.max_results ?? args.per_page)
      })
    case 'codecommit_get_file':
      return codecommitGetFile({
        repositoryName: String(args.repository_name ?? args.repo ?? ''),
        filePath: String(args.file_path ?? args.path ?? ''),
        commitSpecifier: args.commit_specifier
          ? String(args.commit_specifier)
          : args.ref
            ? String(args.ref)
            : undefined
      })
    default:
      return { ok: false, text: '', error: `Unknown CodeCommit tool: ${name}` }
  }
}
