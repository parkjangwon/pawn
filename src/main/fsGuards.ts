import { homedir } from 'os'
import { resolve } from 'path'

const SECRET_TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist']

/** .env, .env.local, .env.production, .npmrc, .netrc ... but not .env.example. */
export function isSecretDotFile(name: string): boolean {
  if (name === '.npmrc' || name === '.netrc' || name === '.pypirc' || name === '.yarnrc.yml') return true
  if (name !== '.env' && !name.startsWith('.env.')) return false
  return !SECRET_TEMPLATE_SUFFIXES.some((s) => name.endsWith(s))
}

const SYSTEM_DIRS = ['/etc', '/var', '/usr', '/bin', '/sbin', '/opt', '/private', '/System', '/Library', '/Applications']

function norm(p: string): string {
  const r = resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')
  // macOS and Windows default to case-insensitive filesystems.
  return (process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r) || '/'
}

/**
 * Recursive delete guard: refuses filesystem roots, top-level system dirs, the
 * home directory itself and any ancestor of it (e.g. /Users, /home).
 */
export function isProtectedRemovePath(target: string, home: string = homedir()): boolean {
  const t = norm(target)
  if (t === '/' || /^[a-z]:$/i.test(t)) return true
  if (SYSTEM_DIRS.some((d) => t === norm(d))) return true
  const h = norm(home)
  return t === h || h.startsWith(t + '/')
}
