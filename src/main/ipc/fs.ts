import { app, ipcMain } from 'electron'
import { handleTrusted } from './trust'
import { join } from 'path'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'

const WALK_IGNORE = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.next', 'coverage', '.turbo', '.cache'])
const WALK_MAX = 3000
const WALK_MAX_DEPTH = 6
// Agent tools (search/grep) and the @-mention index call fs:walk repeatedly;
// a short TTL keeps large projects responsive while staying fresh enough for
// interactive edits.
const WALK_CACHE_TTL_MS = 3000
const WALK_CACHE_MAX = 10
// A single huge synchronous read would freeze the main process (and the UI).
const MAX_READ_BYTES = 32 * 1024 * 1024
// grep-style scans read up to 200 files; bound the TOTAL so a hostile repo
// cannot make one call balloon into gigabytes of main-process memory.
const MAX_READ_TOTAL_BYTES = 64 * 1024 * 1024
const walkCache = new Map<string, { at: number; result: Array<{ name: string; path: string; isDirectory: boolean }> }>()

function walkTree(rootPath: string): Array<{ name: string; path: string; isDirectory: boolean }> {
  const results: Array<{ name: string; path: string; isDirectory: boolean }> = []
  const walk = (dir: string, depth: number): void => {
    if (depth > WALK_MAX_DEPTH || results.length >= WALK_MAX) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (results.length >= WALK_MAX) return
      if (e.name.startsWith('.')) continue
      if (WALK_IGNORE.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
      } else {
        results.push({ name: e.name, path: full, isDirectory: false })
      }
    }
  }
  walk(rootPath, 0)
  // Sort by path for deterministic output — filesystem order varies
  // between runs and causes unnecessary cache-prefix drift.
  results.sort((a, b) => a.path.localeCompare(b.path))
  return results
}

function walkTreeCached(rootPath: string): Array<{ name: string; path: string; isDirectory: boolean }> {
  const hit = walkCache.get(rootPath)
  if (hit && Date.now() - hit.at < WALK_CACHE_TTL_MS) {
    walkCache.delete(rootPath)
    walkCache.set(rootPath, hit)
    return hit.result
  }
  if (hit) walkCache.delete(rootPath)
  const result = walkTree(rootPath)
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
    try {
      const s = statSync(filePath)
      if (s.size > MAX_READ_BYTES) {
        return { error: `File too large to read safely (${s.size} bytes, max ${MAX_READ_BYTES})` }
      }
      return readFileSync(filePath, 'utf-8')
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
    for (const p of paths.slice(0, 500)) {
      if (typeof p !== 'string') continue
      try {
        const s = statSync(p)
        if (s.size > MAX_READ_BYTES) {
          out.push({ path: p, error: `File too large to read safely (${s.size} bytes)` })
          continue
        }
        if (totalBytes + s.size > MAX_READ_TOTAL_BYTES) {
          out.push({ path: p, error: 'Total read budget exceeded — try a narrower search' })
          continue
        }
        totalBytes += s.size
        out.push({ path: p, content: readFileSync(p, 'utf-8') })
      } catch (err) {
        out.push({ path: p, error: String(err) })
      }
    }
    return out
  })

  handleTrusted('fs:writeFile', async (_, filePath: string, content: string) => {
    try {
      writeFileSync(filePath, content, 'utf-8')
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:listDir', async (_, dirPath: string) => {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: join(dirPath, e.name)
      }))
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:walk', async (_, rootPath: string) => {
    try {
      return walkTreeCached(rootPath)
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:stat', async (_, filePath: string) => {
    try {
      const s = statSync(filePath)
      return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtimeMs }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:mkdir', async (_, dirPath: string) => {
    try {
      mkdirSync(dirPath, { recursive: true })
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:delete', async (_, filePath: string) => {
    try {
      unlinkSync(filePath)
      walkCache.clear()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('fs:exists', async (_, filePath: string) => {
    return existsSync(filePath)
  })

  handleTrusted('fs:homeDir', async () => {
    try {
      return app.getPath('home')
    } catch {
      return null
    }
  })
}
