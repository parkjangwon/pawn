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

  registerLspRefactorIpc()

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

function validRange(raw: unknown): { startLine: number; startColumn: number; endLine: number; endColumn: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const sl = validPos(r.startLine)
  const sc = validPos(r.startColumn ?? 1)
  const el = validPos(r.endLine ?? r.startLine)
  const ec = validPos(r.endColumn ?? 1)
  if (sl === null || sc === null || el === null || ec === null || el < sl) return null
  return { startLine: sl, startColumn: sc, endLine: el, endColumn: ec }
}

function wrap<T extends object>(fn: () => Promise<T & { error?: string }>): Promise<(T & { ok: boolean }) | { ok: false; error: string }> {
  return fn()
    .then((res) => ({ ...res, ok: !res.error }))
    .catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
}

export function registerLspRefactorIpc(): void {
  const manager = getLspManager()
  handleTrusted('lsp:rename', async (_e, root: unknown, path: unknown, line: unknown, character: unknown, newName: unknown) => {
    const r = validRoot(root)
    const l = validPos(line)
    const c = validPos(character)
    if (!r || typeof path !== 'string' || l === null || c === null || typeof newName !== 'string' || !newName.trim()) {
      return { ok: false, error: 'Invalid arguments' }
    }
    return wrap(() => manager.rename(r, path, l, c, newName.trim()))
  })
  handleTrusted('lsp:symbols', async (_e, root: unknown, path: unknown, query: unknown) => {
    const r = validRoot(root)
    if (!r || typeof path !== 'string') return { ok: false, error: 'Invalid arguments', symbols: [] }
    return wrap(() => (typeof query === 'string' && query.trim() ? manager.workspaceSymbols(r, query.trim(), path) : manager.documentSymbols(r, path)))
  })
  handleTrusted('lsp:callHierarchy', async (_e, root: unknown, path: unknown, line: unknown, character: unknown, direction: unknown) => {
    const r = validRoot(root)
    const l = validPos(line)
    const c = validPos(character)
    if (!r || typeof path !== 'string' || l === null || c === null) return { ok: false, error: 'Invalid arguments', calls: [] }
    return wrap(() => manager.callHierarchy(r, path, l, c, direction === 'outgoing' ? 'outgoing' : 'incoming'))
  })
  handleTrusted('lsp:codeActions', async (_e, root: unknown, path: unknown, range: unknown, only: unknown) => {
    const r = validRoot(root)
    const rg = validRange(range)
    if (!r || typeof path !== 'string' || !rg) return { ok: false, error: 'Invalid arguments', actions: [] }
    const kinds = Array.isArray(only) ? only.filter((k): k is string => typeof k === 'string').slice(0, 10) : undefined
    return wrap(() => manager.codeActions(r, path, rg, kinds))
  })
  handleTrusted('lsp:applyCodeAction', async (_e, root: unknown, path: unknown, index: unknown) => {
    const r = validRoot(root)
    const i = Number(index)
    if (!r || typeof path !== 'string' || !Number.isInteger(i) || i < 0) return { ok: false, error: 'Invalid arguments' }
    return wrap(() => manager.applyCodeAction(r, path, i))
  })
}

export function disposeLsp(): Promise<void> {
  return getLspManager().disposeAll()
}
