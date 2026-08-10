/**
 * Project-local artifacts shelf (reports, notes, exports).
 * Default dir: <project>/artifacts
 */

function join(root: string, ...parts: string[]): string {
  const base = root.replace(/[/\\]+$/, '')
  return [base, ...parts.map((p) => p.replace(/^[/\\]+/, ''))].join('/').replace(/\\/g, '/')
}

function safeName(name: string): string | null {
  const n = name.trim().replace(/\\/g, '/')
  if (!n || n.includes('..') || n.startsWith('/') || n.includes('\0')) return null
  // allow nested paths under artifacts only
  if (n.split('/').some((s) => s === '..' || s === '')) return null
  return n
}

export async function listArtifacts(projectPath: string, subdir = ''): Promise<string> {
  return listArtifactsDir(join(projectPath, 'artifacts'), subdir)
}

/** List an explicit artifacts root (project shelf or the default fallback dir). */
export async function listArtifactsDir(root: string, subdir = ''): Promise<string> {
  if (subdir && !safeName(subdir)) {
    return 'Invalid subdirectory (no .., absolute paths, or empty segments)'
  }
  const dir = subdir ? join(root, subdir) : root
  const exists = await window.api.fs.exists(root)
  if (!exists) {
    return `No artifacts/ directory yet under ${root}. Use write_artifact to create one.`
  }
  const list = await window.api.fs.listDir(dir)
  if (!Array.isArray(list)) {
    return (list as { error: string }).error || 'list failed'
  }
  if (!list.length) return `artifacts/${subdir || ''} is empty`
  const lines = list.map((e) => `${e.isDirectory ? 'dir' : 'file'} ${e.name}`)
  return [`# artifacts/${subdir || ''}`, `path: ${root}`, '', ...lines].join('\n')
}

/**
 * Default artifacts shelf when no project is open: <downloads>/pawn-artifacts,
 * falling back to <home>/pawn-artifacts when the downloads path is unavailable.
 */
export async function defaultArtifactsDir(): Promise<string | null> {
  try {
    const downloads = await window.api.fs?.downloadsPath?.()
    if (downloads) return join(downloads, 'pawn-artifacts')
    const home = await window.api.fs?.homeDir?.()
    if (home) return join(home, 'pawn-artifacts')
  } catch {
    /* ignore */
  }
  return null
}

export async function writeArtifact(
  projectPath: string,
  name: string,
  content: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  return writeArtifactTo(join(projectPath, 'artifacts'), name, content)
}

/** Write into an explicit artifacts root (project shelf or the default dir). */
export async function writeArtifactTo(
  dir: string,
  name: string,
  content: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const safe = safeName(name)
  if (!safe) return { ok: false, error: 'Invalid artifact name (no .., absolute paths, or empty)' }
  const full = join(dir, safe)
  // ensure parent dirs
  const parent = full.includes('/') ? full.slice(0, full.lastIndexOf('/')) : dir
  const mk = await window.api.fs.mkdir(parent)
  if (mk && 'error' in mk && mk.error) {
    // mkdir may fail if exists — try write anyway
  }
  // ensure artifacts root
  await window.api.fs.mkdir(dir)
  const res = await window.api.fs.writeFile(full, content)
  if (res && 'error' in res && res.error) return { ok: false, error: res.error }
  return { ok: true, path: full }
}
