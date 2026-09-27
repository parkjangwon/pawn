/**
 * Working folder for chats without a project folder ("General" chats).
 *
 * Without one, relative paths the agent writes (`src/utils/format.js`) would
 * resolve against the app process's own working directory — the app bundle,
 * `/`, or (in development) the Pawn repository itself. General chats work in
 * `<Downloads>/pawn-artifacts` instead, the same shelf research reports and
 * artifacts already use, so generated files are easy to find.
 */

import { defaultArtifactsDir } from '../agent/artifacts'

let cached: string | null = null
let pending: Promise<string | null> | null = null

export function generalWorkspaceDirSync(): string | null {
  return cached
}

/** Resolve (and create) the General workspace folder; null when unavailable. */
export function generalWorkspaceDir(): Promise<string | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = (async () => {
      const dir = await defaultArtifactsDir()
      if (!dir) return null
      try {
        await window.api.fs.mkdir(dir)
      } catch {
        /* exists or not creatable — callers still get the path */
      }
      cached = dir
      return dir
    })().finally(() => {
      pending = null
    })
  }
  return pending
}

/** Test hook. */
export function __resetGeneralWorkspace(): void {
  cached = null
  pending = null
}
