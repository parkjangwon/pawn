/**
 * Fast local content search for agent tools.
 * Prefer ripgrep, then git-grep. No network, no paid deps.
 */
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export type ContentSearchOpts = {
  query: string
  fixedString?: boolean
  caseInsensitive?: boolean
  /** ripgrep/git path glob, e.g. "*.ts" or "src/**" */
  glob?: string
  maxMatches?: number
  contextLines?: number
  timeoutMs?: number
}

export type ContentMatch = {
  path: string
  line: number
  text: string
}

export type ContentSearchResult = {
  engine: 'rg' | 'git-grep' | 'none'
  matches: ContentMatch[]
  truncated: boolean
  error?: string
}

const DEFAULT_GLOBS_EXCLUDE = [
  '!node_modules/**',
  '!.git/**',
  '!dist/**',
  '!build/**',
  '!out/**',
  '!release/**',
  '!coverage/**',
  '!.next/**',
  '!.nuxt/**',
  '!.turbo/**',
  '!.cache/**',
  '!target/**',
  '!vendor/**',
  '!**/.venv/**',
  '!**/venv/**',
  '!**/__pycache__/**'
]

let cachedRg: string | null | undefined

/** Resolve ripgrep binary once per process. */
export function resolveRgBin(): string | null {
  if (cachedRg !== undefined) return cachedRg
  const candidates = ['rg', '/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 1500, windowsHide: true })
      if (r.status === 0) {
        cachedRg = bin
        return bin
      }
    } catch {
      // try next
    }
  }
  cachedRg = null
  return null
}

/** Test helper — clear memoized rg path. */
export function resetRgCache(): void {
  cachedRg = undefined
}

function clampMax(n: unknown, fallback: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(200, Math.max(1, Math.floor(v)))
}

function run(bin: string, args: string[], cwd: string, timeoutMs: number): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  try {
    const r = spawnSync(bin, args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, LANG: 'C' }
    })
    return {
      ok: r.error == null,
      stdout: typeof r.stdout === 'string' ? r.stdout : '',
      stderr: typeof r.stderr === 'string' ? r.stderr : '',
      status: r.status
    }
  } catch (err) {
    return { ok: false, stdout: '', stderr: String(err), status: null }
  }
}

function parseRgJson(stdout: string, maxMatches: number): { matches: ContentMatch[]; truncated: boolean } {
  const matches: ContentMatch[] = []
  let truncated = false
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    if (matches.length >= maxMatches) {
      truncated = true
      break
    }
    try {
      const obj = JSON.parse(line) as {
        type?: string
        data?: {
          path?: { text?: string }
          lines?: { text?: string }
          line_number?: number
        }
      }
      if (obj.type !== 'match' || !obj.data) continue
      const path = obj.data.path?.text
      const text = obj.data.lines?.text
      const lineNo = obj.data.line_number
      if (!path || text == null || lineNo == null) continue
      matches.push({
        path,
        line: lineNo,
        text: String(text).replace(/\r?\n$/, '').slice(0, 400)
      })
    } catch {
      // ignore malformed
    }
  }
  return { matches, truncated }
}

function searchWithRg(root: string, opts: ContentSearchOpts, timeoutMs: number): ContentSearchResult | null {
  const bin = resolveRgBin()
  if (!bin) return null
  const maxMatches = clampMax(opts.maxMatches, 80)
  const args = [
    '--json',
    '--color',
    'never',
    '--hidden',
    '--max-filesize',
    '1M',
    '--no-messages'
  ]
  for (const g of DEFAULT_GLOBS_EXCLUDE) {
    args.push('--glob', g)
  }
  if (opts.glob) {
    args.push('--glob', opts.glob)
  }
  if (opts.caseInsensitive) args.push('-i')
  if (opts.fixedString) args.push('-F')
  const ctx = Math.min(3, Math.max(0, Number(opts.contextLines) || 0))
  if (ctx > 0) args.push('-C', String(ctx))
  // Soft cap: a bit over max so JSON parse can truncate cleanly
  args.push('--max-count', String(Math.min(maxMatches, 50)))
  args.push('--', opts.query, '.')

  const r = run(bin, args, root, timeoutMs)
  // rg exits 1 when no matches; 2 on error
  if (r.status === 2 && !r.stdout) {
    return { engine: 'rg', matches: [], truncated: false, error: r.stderr.slice(0, 300) || 'rg failed' }
  }
  if (!r.ok && r.status == null) {
    return null // binary missing / spawn failed — try fallback
  }
  const parsed = parseRgJson(r.stdout, maxMatches)
  return { engine: 'rg', matches: parsed.matches, truncated: parsed.truncated }
}

/** git-grep: works in repos without rg; respects .gitignore. */
function searchWithGitGrep(root: string, opts: ContentSearchOpts, timeoutMs: number): ContentSearchResult | null {
  if (!existsSync(join(root, '.git'))) return null
  const maxMatches = clampMax(opts.maxMatches, 80)
  const args = ['-C', root, 'grep', '-n', '-I', '--no-color']
  if (opts.caseInsensitive) args.push('-i')
  if (opts.fixedString) args.push('-F')
  args.push('-e', opts.query)
  if (opts.glob) {
    args.push('--', opts.glob)
  }

  const r = run('git', args, root, timeoutMs)
  // 0 = matches, 1 = no matches, other = error
  if (r.status != null && r.status > 1) {
    return null
  }
  if (!r.ok && r.status == null) return null

  const matches: ContentMatch[] = []
  let truncated = false
  for (const raw of r.stdout.split('\n')) {
    if (!raw) continue
    if (matches.length >= maxMatches) {
      truncated = true
      break
    }
    // path:line:text  (path may contain drive letters rarely in git-bash)
    const m = raw.match(/^(.*?):(\d+):(.*)$/)
    if (!m) continue
    const rel = m[1]
    matches.push({
      path: join(root, rel),
      line: Number(m[2]),
      text: m[3].slice(0, 400)
    })
  }
  return { engine: 'git-grep', matches, truncated }
}

/**
 * Search file contents under root. Never throws.
 * engine=none means caller should use the JS walk fallback.
 */
export function contentSearch(root: string, opts: ContentSearchOpts): ContentSearchResult {
  const q = (opts.query || '').trim()
  if (!q) {
    return { engine: 'none', matches: [], truncated: false, error: 'query is required' }
  }
  if (q.length > 512) {
    return { engine: 'none', matches: [], truncated: false, error: 'Pattern too long (max 512 chars)' }
  }
  const rootPath = root.replace(/[/\\]+$/, '')
  if (!rootPath || !existsSync(rootPath)) {
    return { engine: 'none', matches: [], truncated: false, error: 'Invalid root path' }
  }
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 12_000, 1000), 60_000)

  const rg = searchWithRg(rootPath, opts, timeoutMs)
  if (rg && rg.engine === 'rg') return rg

  const git = searchWithGitGrep(rootPath, opts, timeoutMs)
  if (git) return git

  return { engine: 'none', matches: [], truncated: false }
}

/** Format matches for the agent (compact, path:line: text). */
export function formatContentMatches(
  result: ContentSearchResult,
  root: string,
  query: string
): string {
  if (result.error && result.matches.length === 0) {
    return result.error
  }
  if (result.matches.length === 0) {
    return `No matches for ${JSON.stringify(query)} under ${root} (engine=${result.engine}).`
  }
  const rootNorm = root.replace(/\\/g, '/').replace(/\/$/, '')
  const lines = [
    `# content_search engine=${result.engine} query=${JSON.stringify(query)}`,
    `matches=${result.matches.length}${result.truncated ? ' truncated=true' : ''}`,
    ''
  ]
  for (const m of result.matches) {
    let p = m.path.replace(/\\/g, '/')
    if (p.startsWith(rootNorm + '/')) p = p.slice(rootNorm.length + 1)
    lines.push(`${p}:${m.line}: ${m.text.trim()}`)
  }
  if (result.truncated) lines.push('', '…truncated — narrow the query or path glob for more.')
  return lines.join('\n')
}
