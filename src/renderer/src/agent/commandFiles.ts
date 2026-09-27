/**
 * Files created by shell commands (image converters, generators, `touch`, …)
 * are invisible to the change ledger, which only sees file tools. After a
 * round that ran commands, new files in the working folder are detected and
 * recorded so "Agent changes" lists them and "Undo turn" can remove them.
 *
 * Git repos: untracked, non-ignored files that were not there at turn start.
 * Other folders: files modified since turn start that did not exist then.
 */

import { useChangeLedger } from '../stores/changeLedger'

const MAX_NEW = 30
const MAX_TEXT_BYTES = 256 * 1024

export interface FileBaseline {
  kind: 'git' | 'walk'
  root: string
  startedAt: number
  paths: Set<string>
}

async function gitUntracked(root: string): Promise<Set<string> | null> {
  const r = await window.api?.shell?.execFile?.('git', ['status', '--porcelain=v1', '-z', '-uall'], root, 15_000).catch(() => null)
  if (!r || typeof r !== 'object' || (r as { exitCode?: number }).exitCode !== 0) return null
  const out = new Set<string>()
  for (const entry of String((r as { stdout?: string }).stdout || '').split('\0')) {
    if (entry.startsWith('?? ')) out.add(`${root.replace(/\/$/, '')}/${entry.slice(3)}`)
  }
  return out
}

export async function takeFileBaseline(root: string | undefined): Promise<FileBaseline | null> {
  if (!root) return null
  const startedAt = Date.now()
  const git = await gitUntracked(root)
  if (git) return { kind: 'git', root, startedAt, paths: git }
  const walk = await window.api?.fs?.walk?.(root).catch(() => null)
  if (!Array.isArray(walk)) return null
  return { kind: 'walk', root, startedAt, paths: new Set(walk.filter((e) => !e.isDirectory).map((e) => e.path)) }
}

async function candidates(base: FileBaseline): Promise<string[]> {
  if (base.kind === 'git') {
    const now = await gitUntracked(base.root)
    return now ? Array.from(now).filter((p) => !base.paths.has(p)) : []
  }
  const minutes = Math.max(1, Math.ceil((Date.now() - base.startedAt) / 60_000) + 1)
  const r = await window.api?.shell
    ?.execFile?.('find', [base.root, '-maxdepth', '4', '-type', 'f', '-mmin', `-${minutes}`, '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'], base.root, 15_000)
    .catch(() => null)
  if (!r || typeof r !== 'object' || (r as { exitCode?: number }).exitCode !== 0) return []
  return String((r as { stdout?: string }).stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((p) => p && !base.paths.has(p))
}

/** Record files commands created this turn; returns the newly recorded paths. */
export async function recordCommandCreatedFiles(base: FileBaseline | null): Promise<string[]> {
  if (!base) return []
  const ledger = useChangeLedger.getState()
  const turn = ledger.turns.find((t) => t.id === ledger.activeTurnId)
  if (!turn) return []
  const known = new Set(turn.changes.map((c) => c.path))
  const fresh = (await candidates(base)).filter((p) => !known.has(p)).slice(0, MAX_NEW)
  for (const path of fresh) {
    base.paths.add(path)
    let after: string | undefined
    const st = await window.api.fs.stat(path).catch(() => null)
    if (st && !('error' in st) && st.size <= MAX_TEXT_BYTES && !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|mp[34]|mov|wasm|bin)$/i.test(path)) {
      const text = await window.api.fs.readFile(path).catch(() => null)
      if (typeof text === 'string' && !text.includes('\u0000')) after = text
    }
    ledger.recordChange({ path, before: null, ...(after !== undefined ? { after } : {}), op: 'write', byCommand: true })
  }
  return fresh
}
