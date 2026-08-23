import { app, ipcMain } from 'electron'
import { handleTrusted } from './trust'
import { join, relative } from 'path'
import { readFile, writeFile, readdir, stat, mkdir, unlink, rmdir, access } from 'fs/promises'
import { cp, rm } from 'fs/promises'
import { readSpreadsheet } from '../spreadsheet'
import { contentSearch, formatContentMatches, type ContentSearchOpts } from '../contentSearch'

const WALK_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.svelte-kit',
  'vendor',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.venv',
  'venv',
  '.idea',
  '.yarn',
  'target' // rust/java build output (shallow name match is OK for walk skip)
])
// Dot-directories we *do* want to index for coding agents
const WALK_ALLOW_DOT_DIRS = new Set([
  '.github',
  '.claude',
  '.agent',
  '.agents',
  '.vscode',
  '.cursor',
  '.pawn',
  '.config'
])
// Dot-files we want searchable (configs agents actually need)
const WALK_ALLOW_DOT_FILES = new Set([
  '.env',
  '.env.example',
  '.env.local',
  '.env.development',
  '.env.production',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.json',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.babelrc',
  '.dockerignore'
])
// Monorepos and nested packages need more than 6 levels (e.g. apps/web/src/features/x).
const WALK_MAX = 12_000
const WALK_MAX_DEPTH = 14
// Agent tools (search/grep) and the @-mention index call fs:walk repeatedly;
// a short TTL keeps large projects responsive while staying fresh enough for
// interactive edits.
// Agent search is chatty; a slightly longer TTL keeps large monorepos snappy
// while writes still clear the cache immediately.
const WALK_CACHE_TTL_MS = 15_000
const WALK_CACHE_MAX = 10
// A single huge synchronous read would freeze the main process (and the UI).
const MAX_READ_BYTES = 32 * 1024 * 1024
// grep-style scans read up to 400 files; bound the TOTAL so a hostile repo
// cannot make one call balloon into gigabytes of main-process memory.
const MAX_READ_TOTAL_BYTES = 96 * 1024 * 1024
const walkCache = new Map<string, { at: number; result: Array<{ name: string; path: string; isDirectory: boolean }> }>()
const MAX_WRITE_CHARS = 32 * 1024 * 1024

/** Reject null bytes / non-strings before any fs call. */
function safePath(p: unknown): string | null {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null
  return p
}

// --- gitignore-style matching (mirrors renderer utils/gitignore.ts) ---
type IgnoreRule = {
  negate: boolean
  dirOnly: boolean
  anchored: boolean
  test: (relPath: string, isDirectory: boolean) => boolean
}

function globToRegExp(pattern: string): RegExp {
  let i = 0
  let out = ''
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 3
        } else {
          out += '.*'
          i += 2
        }
      } else {
        out += '[^/]*'
        i++
      }
    } else if (c === '?') {
      out += '[^/]'
      i++
    } else if ('+|(){}^$.'.includes(c)) {
      out += '\\' + c
      i++
    } else {
      out += c
      i++
    }
  }
  return new RegExp(`^${out}$`)
}

function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine
    if (!line || line.startsWith('#')) continue
    if (!line.endsWith('\\ ')) line = line.replace(/ +$/, '')
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    }
    if (!line) continue
    let dirOnly = false
    if (line.endsWith('/') && line.length > 1) {
      dirOnly = true
      line = line.slice(0, -1)
    }
    let anchored = false
    if (line.startsWith('/')) {
      anchored = true
      line = line.slice(1)
    }
    const re = globToRegExp(line)
    rules.push({
      negate,
      dirOnly,
      anchored,
      test: (relPath, isDirectory) => {
        if (dirOnly && !isDirectory) return false
        const norm = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
        if (anchored) return re.test(norm)
        if (re.test(norm)) return true
        const parts = norm.split('/')
        for (let i = 0; i < parts.length; i++) {
          if (re.test(parts.slice(i).join('/')) || re.test(parts[i])) return true
        }
        return false
      }
    })
  }
  return rules
}

function isGitIgnored(relPath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let norm = relPath.split('\\').join('/')
  if (norm.startsWith('./')) norm = norm.slice(2)
  const candidates: Array<{ path: string; isDir: boolean }> = [{ path: norm, isDir: isDirectory }]
  const parts = norm.split('/').filter(Boolean)
  for (let i = 1; i < parts.length; i++) {
    candidates.push({ path: parts.slice(0, i).join('/'), isDir: true })
  }
  let ignored = false
  for (const rule of rules) {
    for (const c of candidates) {
      if (rule.test(c.path, c.isDir)) ignored = !rule.negate
    }
  }
  return ignored
}

async function loadIgnoreRules(rootPath: string): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = []
  for (const name of ['.gitignore', '.pawnignore']) {
    try {
      const p = join(rootPath, name)
      const text = await readFile(p, 'utf-8')
      rules.push(...parseGitignore(text))
    } catch {
      /* ignore — file doesn't exist */
    }
  }
  return rules
}

function shouldSkipEntry(name: string, isDirectory: boolean): boolean {
  if (WALK_IGNORE.has(name)) return true
  if (!name.startsWith('.')) return false
  if (isDirectory) return !WALK_ALLOW_DOT_DIRS.has(name)
  if (WALK_ALLOW_DOT_FILES.has(name)) return false
  // Allow .env.* variants and common RC files
  if (name.startsWith('.env.')) return false
  if (name.endsWith('rc') || name.endsWith('rc.js') || name.endsWith('rc.cjs') || name.endsWith('rc.json')) return false
  return true
}

async function walkTree(rootPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> {
  const results: Array<{ name: string; path: string; isDirectory: boolean }> = []
  const ignoreRules = await loadIgnoreRules(rootPath)
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > WALK_MAX_DEPTH || results.length >= WALK_MAX) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (results.length >= WALK_MAX) return
      const isDir = e.isDirectory()
      if (shouldSkipEntry(e.name, isDir)) continue
      const full = join(dir, e.name)
      let rel: string
      try {
        rel = relative(rootPath, full).replace(/\\/g, '/')
      } catch {
        rel = e.name
      }
      if (ignoreRules.length > 0 && isGitIgnored(rel, isDir, ignoreRules)) continue
      if (isDir) {
        results.push({ name: e.name, path: full, isDirectory: true })
        await walk(full, depth + 1)
      } else {
        results.push({ name: e.name, path: full, isDirectory: false })
      }
    }
  }
  await walk(rootPath, 0)
  return results
}

async function walkTreeCached(rootPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> {
  const hit = walkCache.get(rootPath)
  if (hit && Date.now() - hit.at < WALK_CACHE_TTL_MS) {
    walkCache.delete(rootPath)
    walkCache.set(rootPath, hit)
    return hit.result
  }
  if (hit) walkCache.delete(rootPath)
  const result = await walkTree(rootPath)
  walkCache.set(rootPath, { at: Date.now(), result })
  if (walkCache.size > WALK_CACHE_MAX) {
    walkCache.forEach((_v, k) => {
      if (walkCache.size <= WALK_CACHE_MAX) return
      walkCache.delete(k)
    })
  }
  return result
}

export function registerFsIpc(): void {
  handleTrusted('fs:readFile', async (_, filePath: string) => {
    const path = safePath(filePath)
    if (!path) return { error: 'Invalid path' }
    try {
      const s = await stat(path)
      if (s.size > MAX_READ_BYTES) {
        return { error: `File too large to read safely (${s.size} bytes, max ${MAX_READ_BYTES})` }
      }
      return await readFile(path, 'utf-8')
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Bulk variant for grep-style scans: one IPC round trip instead of one per
  // file, each read still capped so a huge file cannot stall the main process.
  handleTrusted('fs:readFiles', async (_, paths: unknown) => {
    if (!Array.isArray(paths)) return { error: 'Invalid paths' }
    const out: Array<{ path: string; content?: string; error?: string }> = []
    let totalBytes = 0
    for (const raw of paths.slice(0, 500)) {
      const p = safePath(raw)
      if (!p) continue
      try {
        const s = await stat(p)
        if (s.size > MAX_READ_BYTES) {
          out.push({ path: p, error: `File too large to read safely (${s.size} bytes)` })
          continue
        }
        if (totalBytes + s.size > MAX_READ_TOTAL_BYTES) {
          out.push({ path: p, error: 'Total read budget exceeded — try a narrower search' })
          continue
        }
        totalBytes += s.size
        out.push({ path: p, content: await readFile(p, 'utf-8') })
      } catch (err) {
        out.push({ path: p, error: String(err) })
      }
    }
    return out
  })

  handleTrusted('fs:writeFile', async (_, filePath: string, content: string) => {
    const path = safePath(filePath)
    if (!path) return { error: 'Invalid path' }
    if (typeof content !== 'string') return { error: 'Invalid content' }
    if (content.length > MAX_WRITE_CHARS) {
      return { error: `Content too large to write safely (${content.length} chars, max ${MAX_WRITE_CHARS})` }
    }
    try {
      // Ensure parent directory exists (agents often write new nested files).
      const parent = join(path, '..')
      try { await access(parent) } catch { await mkdir(parent, { recursive: true }) }
      await writeFile(path, content, 'utf-8')
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:listDir', async (_, dirPath: string) => {
    const path = safePath(dirPath)
    if (!path) return { error: 'Invalid path' }
    try {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: join(path, e.name)
      }))
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:walk', async (_, rootPath: string) => {
    const path = safePath(rootPath)
    if (!path) return { error: 'Invalid path' }
    try {
      return await walkTreeCached(path)
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:stat', async (_, filePath: string) => {
    const path = safePath(filePath)
    if (!path) return { error: 'Invalid path' }
    try {
      const s = await stat(path)
      return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtimeMs }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:mkdir', async (_, dirPath: string) => {
    const path = safePath(dirPath)
    if (!path) return { error: 'Invalid path' }
    try {
      await mkdir(path, { recursive: true })
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Agent delete_file: files and empty directories only. Recursive trees use
  // fs:removeDir (skill installer) or shell_exec with an explicit rm -rf.
  handleTrusted('fs:delete', async (_, filePath: string) => {
    const path = safePath(filePath)
    if (!path) return { error: 'Invalid path' }
    try {
      const s = await stat(path)
      if (s.isDirectory()) {
        try {
          await rmdir(path)
        } catch {
          return {
            error: `Directory not empty: ${path}. Remove contents first, or use shell_exec carefully for recursive delete.`
          }
        }
      } else {
        await unlink(path)
      }
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:exists', async (_, filePath: string) => {
    const path = safePath(filePath)
    if (!path) return false
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  })

  handleTrusted('fs:homeDir', async () => {
    try {
      return app.getPath('home')
    } catch {
      return null
    }
  })

  handleTrusted('fs:downloadsPath', async () => {
    try {
      return app.getPath('downloads')
    } catch {
      return null
    }
  })

  // Recursive copy/remove for the skill installer. These replace shell
  // `cp -R` / `rm -rf` invocations, which risked command injection through
  // repo-controlled paths.
  handleTrusted('fs:copyDir', async (_, srcDir: string, destDir: string) => {
    const src = safePath(srcDir)
    const dest = safePath(destDir)
    if (!src || !dest) return { error: 'Invalid copy paths' }
    try {
      await cp(src, dest, { recursive: true, force: true, errorOnExist: false })
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:removeDir', async (_, dirPath: string) => {
    const path = safePath(dirPath)
    if (!path) return { error: 'Invalid path' }
    // Refuse filesystem roots and bare home — recursive delete is too dangerous.
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
    if (
      normalized === '/' ||
      normalized === '' ||
      /^[A-Za-z]:$/.test(normalized) ||
      normalized === '/Users' ||
      normalized === '/home' ||
      normalized === '/etc' ||
      normalized === '/var' ||
      normalized === '/System' ||
      normalized === '/Library'
    ) {
      return { error: `Refused to remove protected path: ${path}` }
    }
    try {
      await rm(path, { recursive: true, force: true })
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Bounded CSV / XLSX read for agent tools (row/col caps inside readSpreadsheet).
  handleTrusted('fs:readSpreadsheet', async (_, filePath: string, opts?: { sheet?: string; maxRows?: number; maxCols?: number }) => {
    const path = safePath(filePath)
    if (!path || !path.trim()) return { error: 'Invalid path' }
    try {
      return await readSpreadsheet(path.trim(), opts || {})
    } catch (err) {
      return { error: String(err) }
    }
  })

  // Fast content search (rg → git-grep). engine=none → renderer JS fallback.
  handleTrusted('fs:contentSearch', async (_, rootPath: string, opts: ContentSearchOpts) => {
    if (!safePath(rootPath) || !String(rootPath).trim()) {
      return { engine: 'none' as const, matches: [], truncated: false, error: 'Invalid root path' }
    }
    try {
      const result = await contentSearch(rootPath.trim(), opts || { query: '' })
      return {
        ...result,
        text: formatContentMatches(result, rootPath.trim(), String(opts?.query || ''))
      }
    } catch (err) {
      return {
        engine: 'none' as const,
        matches: [],
        truncated: false,
        error: String(err)
      }
    }
  })
}
