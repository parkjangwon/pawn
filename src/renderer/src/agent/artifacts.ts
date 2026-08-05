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
  const root = join(projectPath, 'artifacts', subdir)
  const exists = await window.api.fs.exists(join(projectPath, 'artifacts'))
  if (!exists) {
    return `No artifacts/ directory yet under ${projectPath}. Use write_artifact to create one.`
  }
  const list = await window.api.fs.listDir(root)
  if (!Array.isArray(list)) {
    return (list as { error: string }).error || 'list failed'
  }
  if (!list.length) return `artifacts/${subdir || ''} is empty`
  const lines = list.map((e) => `${e.isDirectory ? 'dir ' : 'file'} ${e.name}`)
  return [`# artifacts/${subdir || ''}`, `path: ${root}`, '', ...lines].join('\n')
}

export async function writeArtifact(
  projectPath: string,
  name: string,
  content: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const safe = safeName(name)
  if (!safe) return { ok: false, error: 'Invalid artifact name (no .., absolute paths, or empty)' }
  const dir = join(projectPath, 'artifacts')
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
