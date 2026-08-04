import { useCallback, useEffect, useRef, useState } from 'react'

export interface GitSummary {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  filesChanged: number
  insertions: number
  deletions: number
}

const EMPTY: GitSummary = {
  isRepo: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  filesChanged: 0,
  insertions: 0,
  deletions: 0
}

// Cheap enough to poll: both commands are read-only and typically resolve in
// single-digit milliseconds even in large repos.
const POLL_MS = 8000

function parseStatus(stdout: string): { branch: string | null; upstream: string | null; ahead: number; behind: number; filesChanged: number } {
  const lines = stdout.split('\n').filter(Boolean)
  const branchLine = lines[0]?.startsWith('##') ? lines[0] : ''
  const filesChanged = branchLine ? lines.length - 1 : lines.length
  const branchMatch = branchLine.match(/^## (?:No commits yet on )?([^\s.]+)/)
  const upstreamMatch = branchLine.match(/\.\.\.(\S+)/)
  const aheadMatch = branchLine.match(/ahead (\d+)/)
  const behindMatch = branchLine.match(/behind (\d+)/)
  return {
    branch: branchMatch?.[1] || null,
    upstream: upstreamMatch?.[1] || null,
    ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
    behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
    filesChanged
  }
}

function parseShortstat(stdout: string): { insertions: number; deletions: number } {
  const insMatch = stdout.match(/(\d+) insertion/)
  const delMatch = stdout.match(/(\d+) deletion/)
  return {
    insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0
  }
}

/** Live branch + working-tree diff stat for the git status chip. Polls lightly
 *  and refreshes on window focus so it stays fresh without the caller having
 *  to know when files changed underneath it (agent tool calls, external edits). */
export function useGitSummary(projectPath: string): GitSummary & { refresh: () => void } {
  const [summary, setSummary] = useState<GitSummary>(EMPTY)
  const pathRef = useRef(projectPath)
  pathRef.current = projectPath

  const refresh = useCallback(() => {
    const path = pathRef.current
    if (!path) { setSummary(EMPTY); return }
    Promise.all([
      window.api.shell.exec('git status --porcelain -b', path),
      window.api.shell.exec('git diff --shortstat HEAD', path)
    ]).then(([statusRes, diffRes]) => {
      if (statusRes.exitCode !== 0) { setSummary(EMPTY); return }
      const status = parseStatus(statusRes.stdout)
      const shortstat = diffRes.exitCode === 0 ? parseShortstat(diffRes.stdout) : { insertions: 0, deletions: 0 }
      setSummary({ isRepo: true, ...status, ...shortstat })
    }).catch(() => setSummary(EMPTY))
  }, [])

  useEffect(() => {
    refresh()
    if (!pathRef.current) return
    const id = setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refresh)
    }
  }, [projectPath, refresh])

  return { ...summary, refresh }
}
