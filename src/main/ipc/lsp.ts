import { statSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import { handleTrusted } from './trust'
import { loadConfig } from '../config'
import { isProtectedRemovePath } from '../fsGuards'
import { getLspManager } from '../lsp/manager'

/**
 * Language-server IPC. A workspace root must be a real project directory —
 * never `/`, the home directory, or a system folder (a server would try to
 * index the whole disk).
 */
function validRoot(root: unknown): string | null {
  if (typeof root !== 'string' || !root.trim() || !isAbsolute(root)) return null
  const abs = resolve(root)
  if (isProtectedRemovePath(abs)) return null
  try {
    return statSync(abs).isDirectory() ? abs : null
  } catch {
    return null
  }
}

function validPos(n: unknown): number | null {
  const v = Number(n)
  return Number.isInteger(v) && v >= 1 && v < 10_000_000 ? v : null
}

export function registerLspIpc(): void {
  const manager = getLspManager()
  try {
    manager.setEnabled(loadConfig().settings?.lspDiagnostics !== false)
  } catch {
    /* default on */
  }

  handleTrusted('lsp:setEnabled', async (_e, enabled: unknown) => {
    manager.setEnabled(enabled === true)
    return { ok: true }
  })

  handleTrusted('lsp:status', async (_e, root: unknown) => {
    const r = typeof root === 'string' ? validRoot(root) : null
    return manager.status(r ?? undefined)
  })

  handleTrusted('lsp:diagnostics', async (_e, root: unknown, paths: unknown, opts: unknown) => {
    const r = validRoot(root)
    if (!r) return { ok: false, error: 'Invalid project root', files: [] }
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && !!p) : []
    if (!list.length) return { ok: false, error: 'No paths', files: [] }
    const o = (opts && typeof opts === 'object' ? opts : {}) as { waitMs?: unknown; content?: unknown }
    const content =
      o.content && typeof o.content === 'object'
        ? Object.fromEntries(
            Object.entries(o.content as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string'
            )
          )
        : undefined
    const res = await manager.diagnostics(r, list, {
      waitMs: typeof o.waitMs === 'number' ? o.waitMs : undefined,
      content
    })
    return {
      ok: res.files.length > 0 || res.errors.length === 0,
      ...(res.errors.length ? { error: res.errors.join('; ') } : {}),
      files: res.files,
      unsupported: res.unsupported
    }
  })

  for (const [channel, method] of [
    ['lsp:definition', 'textDocument/definition'],
    ['lsp:references', 'textDocument/references']
  ] as const) {
    handleTrusted(channel, async (_e, root: unknown, path: unknown, line: unknown, character: unknown) => {
      const r = validRoot(root)
      const l = validPos(line)
      const c = validPos(character)
      if (!r || typeof path !== 'string' || l === null || c === null) {
        return { ok: false, error: 'Invalid arguments', locations: [] }
      }
      try {
        const res = await manager.locations(method, r, path, l, c)
        return { ok: !res.error, ...res }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), locations: [] }
      }
    })
  }

  handleTrusted('lsp:hover', async (_e, root: unknown, path: unknown, line: unknown, character: unknown) => {
    const r = validRoot(root)
    const l = validPos(line)
    const c = validPos(character)
    if (!r || typeof path !== 'string' || l === null || c === null) return { ok: false, error: 'Invalid arguments' }
    try {
      const res = await manager.hover(r, path, l, c)
      return { ok: !res.error, ...res }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

export function disposeLsp(): Promise<void> {
  return getLspManager().disposeAll()
}
