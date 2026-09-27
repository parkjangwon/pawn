/**
 * Mentioned-file prefetch: when the user's message names files that exist in
 * the project, attach their current contents to the message before the first
 * model call — saving a read round trip (often several) at the start of a
 * turn. Bounded in count and size; binary and huge files are skipped.
 */

export interface PrefetchedFile {
  path: string
  rel: string
  content: string
  totalLines: number
  shownLines: number
}

const MAX_FILES = 5
const MAX_FILE_CHARS = 40_000
const MAX_TOTAL_CHARS = 80_000
const MAX_LINES = 400
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|tar|7z|rar|mp[34]|mov|avi|wasm|so|dylib|dll|exe|bin|class|jar|woff2?|ttf|otf|sqlite|db|lock)$/i

/** Path-like tokens in free text: `src/a.ts`, ./b.py, @app/x.tsx, "c d/e.md", /abs/f.go. */
export function extractMentionedPaths(text: string): string[] {
  const out: string[] = []
  const add = (raw: string): void => {
    const p = raw.replace(/^@/, '').replace(/[),.;:!?'"`]+$/, '').trim()
    if (!p || p.length > 300 || /^[a-z]+:\/\//i.test(p) || p.includes('://')) return
    if (!/\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(p) && !/^(Makefile|Dockerfile|Justfile|Rakefile|Gemfile)$/.test(p.split('/').pop() || '')) return
    if (BINARY_EXT.test(p)) return
    if (!out.includes(p)) out.push(p)
  }
  // Quoted / backticked (may contain spaces).
  for (const m of Array.from(text.matchAll(/[`"']([^`"'\n]{2,200})[`"']/g))) {
    if (/[/\\.]/.test(m[1])) add(m[1])
  }
  // Bare tokens (outside the quoted spans already handled).
  const rest = text.replace(/[`"']([^`"'\n]{2,200})[`"']/g, ' ')
  for (const m of Array.from(rest.matchAll(/(?:^|[\s(\[{,:])(@?(?:~|\.{1,2})?\/?[\w@+-][\w@.+-]*(?:\/[\w@.+-]+)*(?:\.[A-Za-z0-9]{1,10})?)/g))) {
    const tok = m[1]
    if (tok.includes('/') || /\.[A-Za-z0-9]{1,10}$/.test(tok)) add(tok)
  }
  return out.slice(0, 20)
}

function numbered(lines: string[]): string {
  return lines.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n')
}

/**
 * Resolve and read mentioned files. `resolve` maps a mention to candidate
 * absolute paths (cwd first, then other roots); `read` returns text or null.
 */
export async function prefetchMentionedFiles(
  text: string,
  opts: {
    roots: string[]
    read: (abs: string) => Promise<string | null>
    isFile: (abs: string) => Promise<boolean>
    home?: string
  }
): Promise<PrefetchedFile[]> {
  const mentions = extractMentionedPaths(text)
  if (!mentions.length || !opts.roots.length) return []
  const files: PrefetchedFile[] = []
  let total = 0
  for (const m of mentions) {
    if (files.length >= MAX_FILES || total >= MAX_TOTAL_CHARS) break
    const candidates: string[] = []
    if (m.startsWith('/')) candidates.push(m)
    else if (m.startsWith('~/') && opts.home) candidates.push(`${opts.home}${m.slice(1)}`)
    else for (const r of opts.roots) candidates.push(`${r.replace(/\/$/, '')}/${m.replace(/^\.\//, '')}`)
    for (const abs of candidates) {
      // Only files inside a project root (never arbitrary absolute paths).
      const root = opts.roots.find((r) => abs === r || abs.startsWith(r.endsWith('/') ? r : `${r}/`))
      if (!root || abs.split('/').includes('..')) continue
      if (files.some((f) => f.path === abs)) break
      if (!(await opts.isFile(abs))) continue
      const content = await opts.read(abs)
      if (content === null || content.includes('\u0000')) break
      const lines = content.split('\n')
      let shown = lines.slice(0, MAX_LINES)
      let body = numbered(shown)
      if (body.length > MAX_FILE_CHARS) {
        body = body.slice(0, MAX_FILE_CHARS)
        shown = body.split('\n')
      }
      if (total + body.length > MAX_TOTAL_CHARS && files.length > 0) break
      total += body.length
      files.push({ path: abs, rel: abs.slice(root.length).replace(/^\//, ''), content: body, totalLines: lines.length, shownLines: shown.length })
      break
    }
  }
  return files
}

export function formatPrefetched(files: PrefetchedFile[]): string {
  if (!files.length) return ''
  const blocks = files.map((f) => {
    const range = f.shownLines < f.totalLines ? `1-${f.shownLines} of ${f.totalLines}` : `1-${f.totalLines}`
    const more = f.shownLines < f.totalLines ? `\n…(${f.totalLines - f.shownLines} more lines — read the rest if needed)` : ''
    return `<file path="${f.rel}" lines="${range}">\n${f.content}${more}\n</file>`
  })
  return `\n\n<mentioned_files>\nCurrent contents of files named in this message (already read for you — no need to read them again unless they change):\n${blocks.join('\n')}\n</mentioned_files>`
}
