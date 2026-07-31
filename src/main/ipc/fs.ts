import { app, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'

const WALK_IGNORE = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.next', 'coverage', '.turbo', '.cache'])
const WALK_MAX = 3000
const WALK_MAX_DEPTH = 6

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

export function registerFsIpc(): void {
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    try {
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    try {
      writeFileSync(filePath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:listDir', async (_, dirPath: string) => {
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

  ipcMain.handle('fs:walk', async (_, rootPath: string) => {
    try {
      return walkTree(rootPath)
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:stat', async (_, filePath: string) => {
    try {
      const s = statSync(filePath)
      return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtimeMs }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
    try {
      mkdirSync(dirPath, { recursive: true })
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:delete', async (_, filePath: string) => {
    try {
      unlinkSync(filePath)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('fs:exists', async (_, filePath: string) => {
    return existsSync(filePath)
  })

  ipcMain.handle('fs:homeDir', async () => {
    try {
      return app.getPath('home')
    } catch {
      return null
    }
  })
}
