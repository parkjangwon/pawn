/**
 * Semantic code search index.
 *
 * Walks a repository, chunks source/text files, and builds a hybrid retrieval
 * index combining BM25 lexical scoring with dense cosine similarity from the
 * local hashed embedder. Results are fused with reciprocal-rank fusion plus a
 * handful of structural boosts. The index is persisted to disk and updated
 * incrementally based on file (mtime, size).
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import { cosine, embedText, EMBED_DIM } from '../memory/embed'
import { buildBm25Index, buildDocTokens, bm25Scores, type Bm25Index } from './bm25'
import { chunkFile, languageForPath, type Chunk, type ChunkKind, type Language } from './chunker'
import { tokenize } from './tokenize'

const CACHE_VERSION = 3

// Directories never descended into.
const SKIP_DIRS = new Set<string>([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next',
  'target', 'vendor', '__pycache__', '.venv', 'venv'
])

const SKIP_FILE_RE = /(\.min\.js|\.min\.css|\.map)$/i
const LOCKFILE_RE = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/
const BINARY_EXT = new Set<string>([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg', 'pdf', 'zip', 'gz',
  'tar', 'tgz', 'bz2', 'xz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin',
  'wasm', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp3', 'mp4', 'mov', 'avi',
  'mkv', 'wav', 'flac', 'ogg', 'class', 'jar', 'pyc', 'o', 'a', 'node',
  'sqlite', 'db', 'lock'
])

export interface CodeIndexOptions {
  root: string
  cacheDir: string
}

export interface UpdateOptions {
  signal?: AbortSignal
  maxFiles?: number
  maxFileBytes?: number
}

export interface UpdateStats {
  files: number
  chunks: number
  updatedFiles: number
  ms: number
}

export interface SearchOptions {
  limit?: number
  pathPrefix?: string
  languages?: Language[]
}

export interface SearchHit {
  path: string
  startLine: number
  endLine: number
  symbol?: string
  kind?: ChunkKind
  score: number
  preview: string
}

interface StoredChunk {
  path: string
  startLine: number
  endLine: number
  symbol?: string
  kind?: ChunkKind
  text: string
  // dense embedding rounded to 3 decimals to keep the cache small
  vec: number[]
  tf: Record<string, number>
  length: number
}

interface FileEntry {
  mtimeMs: number
  size: number
  chunkCount: number
}

interface CacheShape {
  version: number
  root: string
  files: Record<string, FileEntry>
  chunks: StoredChunk[]
}

function roundVec(v: Float32Array): number[] {
  const out = new Array<number>(v.length)
  for (let i = 0; i < v.length; i++) out[i] = Math.round(v[i] * 1000) / 1000
  return out
}

function vecFromArray(a: number[]): Float32Array {
  const v = new Float32Array(EMBED_DIM)
  for (let i = 0; i < Math.min(a.length, EMBED_DIM); i++) v[i] = a[i]
  return v
}

function isTestPath(rel: string): boolean {
  return /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$)/.test(rel)
}

/** Very small .gitignore matcher: directory names and simple globs. */
class GitIgnore {
  private dirs = new Set<string>()
  private globs: RegExp[] = []
  private names = new Set<string>()

  static async load(root: string): Promise<GitIgnore> {
    const gi = new GitIgnore()
    try {
      const raw = await fs.readFile(path.join(root, '.gitignore'), 'utf8')
      for (let line of raw.split('\n')) {
        line = line.trim()
        if (!line || line.startsWith('#') || line.startsWith('!')) continue
        const clean = line.replace(/^\//, '').replace(/\/$/, '')
        if (!clean) continue
        if (clean.includes('*') || clean.includes('?')) {
          const re = '^' + clean
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.') + '$'
          gi.globs.push(new RegExp(re))
        } else if (clean.includes('/')) {
          gi.dirs.add(clean)
        } else {
          gi.names.add(clean)
        }
      }
    } catch {
      // no .gitignore
    }
    return gi
  }

  ignores(rel: string, base: string): boolean {
    if (this.names.has(base) || this.dirs.has(rel)) return true
    for (const g of this.globs) if (g.test(base) || g.test(rel)) return true
    return false
  }
}

export class CodeIndex {
  readonly root: string
  readonly cacheDir: string
  private files: Record<string, FileEntry> = {}
  private chunks: StoredChunk[] = []
  private bm25: Bm25Index | null = null

  constructor(opts: CodeIndexOptions) {
    this.root = path.resolve(opts.root)
    this.cacheDir = path.resolve(opts.cacheDir)
  }

  private cacheFile(): string {
    const h = createHash('sha1').update(this.root).digest('hex').slice(0, 16)
    return path.join(this.cacheDir, `${h}.json`)
  }

  /** Restore a persisted index; returns true if a valid cache was loaded. */
  async load(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.cacheFile(), 'utf8')
      const data = JSON.parse(raw) as CacheShape
      if (!data || data.version !== CACHE_VERSION || data.root !== this.root) {
        return false
      }
      if (!Array.isArray(data.chunks) || typeof data.files !== 'object') return false
      this.files = data.files
      this.chunks = data.chunks
      this.rebuildBm25()
      return true
    } catch {
      return false
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true })
    const data: CacheShape = {
      version: CACHE_VERSION,
      root: this.root,
      files: this.files,
      chunks: this.chunks
    }
    const tmp = this.cacheFile() + '.' + process.pid + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
    await fs.rename(tmp, this.cacheFile())
  }

  private rebuildBm25(): void {
    this.bm25 = buildBm25Index(this.chunks.map((c) => ({ tf: c.tf, length: c.length })))
  }

  /** Walk the repo and (re)index changed files incrementally. */
  async update(opts: UpdateOptions = {}): Promise<UpdateStats> {
    const started = Date.now()
    const maxFiles = opts.maxFiles ?? 20000
    const maxFileBytes = opts.maxFileBytes ?? 512 * 1024
    const gitignore = await GitIgnore.load(this.root)

    const found: string[] = []
    await this.walk(this.root, gitignore, found, maxFiles, opts.signal)

    const foundSet = new Set(found)
    let updatedFiles = 0

    // Drop chunks for deleted files.
    const removed: string[] = []
    for (const rel of Object.keys(this.files)) {
      if (!foundSet.has(rel)) removed.push(rel)
    }
    if (removed.length) {
      const removedSet = new Set(removed)
      this.chunks = this.chunks.filter((c) => !removedSet.has(c.path))
      for (const rel of removed) delete this.files[rel]
    }

    // (Re)index changed files.
    for (const rel of found) {
      if (opts.signal?.aborted) break
      const abs = path.join(this.root, rel)
      let stat
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (stat.size > maxFileBytes) continue
      const prev = this.files[rel]
      if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) {
        continue
      }
      let content: string
      try {
        content = await fs.readFile(abs, 'utf8')
      } catch {
        continue
      }
      if (content.indexOf('\u0000') !== -1) continue // binary guard

      // Remove old chunks for this file.
      if (prev) this.chunks = this.chunks.filter((c) => c.path !== rel)

      const fileChunks = chunkFile(rel, content)
      for (const ch of fileChunks) {
        const { tf, length } = buildDocTokens(ch.text, ch.path, ch.symbol)
        const vec = roundVec(embedText(`${ch.symbol || ''} ${ch.path}\n${ch.text}`))
        this.chunks.push({
          path: ch.path,
          startLine: ch.startLine,
          endLine: ch.endLine,
          symbol: ch.symbol,
          kind: ch.kind,
          text: ch.text,
          vec,
          tf,
          length
        })
      }
      this.files[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, chunkCount: fileChunks.length }
      updatedFiles++
    }

    this.rebuildBm25()
    await this.persist()

    return {
      files: Object.keys(this.files).length,
      chunks: this.chunks.length,
      updatedFiles,
      ms: Date.now() - started
    }
  }

  private async walk(
    dir: string,
    gitignore: GitIgnore,
    out: string[],
    maxFiles: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (out.length >= maxFiles) return
    if (signal?.aborted) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return
      const abs = path.join(dir, entry.name)
      const rel = path.relative(this.root, abs).split(path.sep).join('/')
      const base = entry.name

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(base)) continue
        // hidden dot-dirs skipped except .github
        if (base.startsWith('.') && base !== '.github') continue
        if (gitignore.ignores(rel, base)) continue
        await this.walk(abs, gitignore, out, maxFiles, signal)
        continue
      }
      if (!entry.isFile()) continue

      if (base.startsWith('.') && base !== '.gitignore') {
        // skip hidden files (but they're rarely indexable anyway)
      }
      if (SKIP_FILE_RE.test(base)) continue
      if (LOCKFILE_RE.test(base)) continue
      const extMatch = /\.([^.]+)$/.exec(base)
      const ext = extMatch ? extMatch[1].toLowerCase() : ''
      if (BINARY_EXT.has(ext)) continue
      if (gitignore.ignores(rel, base)) continue

      out.push(rel)
    }
  }

  /** Hybrid search across the index. */
  search(queries: string | string[], opts: SearchOptions = {}): SearchHit[] {
    const limit = opts.limit ?? 10
    if (!this.bm25) this.rebuildBm25()
    const bm25 = this.bm25!
    const queryList = Array.isArray(queries) ? queries : [queries]

    // Candidate filter by pathPrefix / languages.
    const allowIdx: number[] = []
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i]
      if (opts.pathPrefix && !c.path.startsWith(opts.pathPrefix)) continue
      if (opts.languages && opts.languages.length) {
        if (!opts.languages.includes(languageForPath(c.path))) continue
      }
      allowIdx.push(i)
    }
    if (!allowIdx.length) return []

    const wantsTest = queryList.some((q) => /\btest|spec\b/i.test(q))

    // Fuse rankings across each query phrasing with RRF.
    const rrf = new Map<number, number>()
    const RRF_K = 60

    for (const q of queryList) {
      const qTokensRaw = tokenize(q)
      const qTokens = qTokensRaw.length ? qTokensRaw : tokenize(q, { stemming: false })
      const bmAll = bm25Scores(bm25, qTokens)
      const qVec = embedText(q)

      // Build per-query candidate scores.
      const bmRanked: Array<{ idx: number; s: number }> = []
      const denseRanked: Array<{ idx: number; s: number }> = []
      for (const idx of allowIdx) {
        bmRanked.push({ idx, s: bmAll[idx] })
        denseRanked.push({ idx, s: cosine(qVec, vecFromArray(this.chunks[idx].vec)) })
      }
      bmRanked.sort((a, b) => b.s - a.s)
      denseRanked.sort((a, b) => b.s - a.s)

      const addRrf = (ranked: Array<{ idx: number; s: number }>): void => {
        for (let r = 0; r < ranked.length; r++) {
          if (ranked[r].s <= 0 && r > 0) continue
          const contrib = 1 / (RRF_K + r + 1)
          rrf.set(ranked[r].idx, (rrf.get(ranked[r].idx) || 0) + contrib)
        }
      }
      addRrf(bmRanked)
      addRrf(denseRanked)
    }

    // Apply boosts.
    const symbolMatch = new Set<string>()
    for (const q of queryList) for (const t of tokenize(q)) symbolMatch.add(t)

    const scored: Array<{ idx: number; score: number }> = []
    for (const [idx, base] of Array.from(rrf.entries())) {
      const c = this.chunks[idx]
      let score = base
      if (c.symbol) {
        const symToks = tokenize(c.symbol)
        if (symToks.some((t) => symbolMatch.has(t))) score *= 2
      }
      const pathToks = tokenize(c.path)
      if (pathToks.some((t) => symbolMatch.has(t))) score *= 1.3
      if (isTestPath(c.path) && !wantsTest) score *= 0.85
      scored.push({ idx, score })
    }
    scored.sort((a, b) => b.score - a.score)

    // Deduplicate overlapping chunks from the same file (keep best).
    const hits: SearchHit[] = []
    const usedRanges: Map<string, Array<[number, number]>> = new Map()
    for (const { idx, score } of scored) {
      if (hits.length >= limit) break
      const c = this.chunks[idx]
      const ranges = usedRanges.get(c.path) || []
      const overlaps = ranges.some(([s, e]) => c.startLine <= e && c.endLine >= s)
      if (overlaps) continue
      ranges.push([c.startLine, c.endLine])
      usedRanges.set(c.path, ranges)
      hits.push({
        path: c.path,
        startLine: c.startLine,
        endLine: c.endLine,
        symbol: c.symbol,
        kind: c.kind,
        score,
        preview: makePreview(c.text)
      })
    }
    return hits
  }

  /** Number of indexed chunks (for tests / diagnostics). */
  get chunkCount(): number {
    return this.chunks.length
  }

  get fileCount(): number {
    return Object.keys(this.files).length
  }
}

function makePreview(text: string): string {
  const lines = text.split('\n').slice(0, 12)
  return lines.map((l) => (l.length > 200 ? l.slice(0, 200) + '…' : l)).join('\n')
}

/** Render search hits as compact, agent-readable text. */
export function formatSearchHits(hits: SearchHit[], opts: { maxPreviewLines?: number } = {}): string {
  const maxLines = opts.maxPreviewLines ?? 12
  const out: string[] = []
  for (const h of hits) {
    const sym = h.symbol ? `  ${h.symbol}` : ''
    out.push(`${h.path}:${h.startLine}-${h.endLine}${sym}  (score ${h.score.toFixed(4)})`)
    const previewLines = h.preview.split('\n').slice(0, maxLines)
    let ln = h.startLine
    for (const line of previewLines) {
      out.push(`    ${String(ln).padStart(5)}  ${line}`)
      ln++
    }
    out.push('')
  }
  return out.join('\n').trimEnd()
}

export { CACHE_VERSION }
