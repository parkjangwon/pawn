import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'
import type { WikiScope } from './types'

let overrideRoot: string | null = null

/** Test hook — point the wiki at a temp dir. */
export function __setWikiRootForTests(dir: string | null): void {
  overrideRoot = dir
}

export function wikiRoot(): string {
  const root = overrideRoot || join(getPawnDir(), 'wiki')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

/** Filesystem-safe directory name for a project id. */
export function safeProjectDir(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  return safe || 'default'
}

export function wikiDir(scope: WikiScope, projectId: string | null): string {
  const dir =
    scope === 'project' && projectId
      ? join(wikiRoot(), 'projects', safeProjectDir(projectId))
      : join(wikiRoot(), 'global')
  if (!existsSync(dir)) mkdirSync(join(dir, 'pages'), { recursive: true })
  return dir
}

export function pagesDir(scope: WikiScope, projectId: string | null): string {
  return join(wikiDir(scope, projectId), 'pages')
}

export function indexPath(scope: WikiScope, projectId: string | null): string {
  return join(wikiDir(scope, projectId), 'index.md')
}

export function logPath(scope: WikiScope, projectId: string | null): string {
  return join(wikiDir(scope, projectId), 'log.md')
}
