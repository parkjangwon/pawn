import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { CodeIndex, formatSearchHits } from '../index'

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

describe('CodeIndex fixture search', () => {
  let repo: string
  let cache: string

  beforeAll(async () => {
    repo = await mkTmp('pawn-ci-repo-')
    cache = await mkTmp('pawn-ci-cache-')
    await writeFile(repo, 'src/net/retry.ts', [
      '/** Compute exponential backoff delay for a retry attempt. */',
      'export function calculateBackoffDelay(attempt: number): number {',
      '  const base = 100',
      '  return Math.min(base * Math.pow(2, attempt), 10000)',
      '}',
      '',
      'export async function fetchWithRetry(url: string): Promise<Response> {',
      '  let lastErr: unknown',
      '  for (let attempt = 0; attempt < 5; attempt++) {',
      '    try {',
      '      return await fetch(url)',
      '    } catch (err) {',
      '      lastErr = err',
      '      await sleep(calculateBackoffDelay(attempt))',
      '    }',
      '  }',
      '  throw lastErr',
      '}',
      '',
      'function sleep(ms: number): Promise<void> {',
      '  return new Promise((r) => setTimeout(r, ms))',
      '}'
    ].join('\n'))
    await writeFile(repo, 'src/util/math.ts', [
      'export function addNumbers(a: number, b: number): number {',
      '  return a + b',
      '}'
    ].join('\n'))
    await writeFile(repo, 'README.md', '# Fixture\n\nA sample project.\n')

    const index = new CodeIndex({ root: repo, cacheDir: cache })
    await index.update()
  })

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true })
    await fs.rm(cache, { recursive: true, force: true })
  })

  it('finds the retry/backoff function from a natural-language query', () => {
    const index = new CodeIndex({ root: repo, cacheDir: cache })
    return index.load().then(() => {
      const hits = index.search('where do we retry failed requests with backoff', { limit: 5 })
      expect(hits.length).toBeGreaterThan(0)
      const top = hits[0]
      expect(top.path).toBe('src/net/retry.ts')
      expect(['calculateBackoffDelay', 'fetchWithRetry']).toContain(top.symbol)
    })
  })

  it('supports multiple phrasings fused with RRF', () => {
    const index = new CodeIndex({ root: repo, cacheDir: cache })
    return index.load().then(() => {
      const hits = index.search(['backoff delay', 'exponential retry attempt'], { limit: 5 })
      expect(hits[0].path).toBe('src/net/retry.ts')
    })
  })

  it('formatSearchHits produces readable output with line numbers', () => {
    const index = new CodeIndex({ root: repo, cacheDir: cache })
    return index.load().then(() => {
      const hits = index.search('backoff', { limit: 2 })
      const text = formatSearchHits(hits)
      expect(text).toContain('src/net/retry.ts:')
      expect(/\d+\s+/.test(text)).toBe(true)
    })
  })

  it('respects pathPrefix filter', () => {
    const index = new CodeIndex({ root: repo, cacheDir: cache })
    return index.load().then(() => {
      const hits = index.search('numbers', { pathPrefix: 'src/util/' })
      expect(hits.every((h) => h.path.startsWith('src/util/'))).toBe(true)
    })
  })
})

describe('CodeIndex incremental & persistence', () => {
  let repo: string
  let cache: string

  beforeAll(async () => {
    repo = await mkTmp('pawn-ci-inc-')
    cache = await mkTmp('pawn-ci-inccache-')
    await writeFile(repo, 'a.ts', 'export function a() { return 1 }\n')
    await writeFile(repo, 'b.ts', 'export function b() { return 2 }\n')
  })

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true })
    await fs.rm(cache, { recursive: true, force: true })
  })

  it('only re-chunks changed files and drops deleted ones', async () => {
    const index = new CodeIndex({ root: repo, cacheDir: cache })
    const s1 = await index.update()
    expect(s1.updatedFiles).toBe(2)

    // Re-run without changes: nothing updated.
    const s2 = await index.update()
    expect(s2.updatedFiles).toBe(0)

    // Modify a.ts (bump mtime to be safe).
    await new Promise((r) => setTimeout(r, 12))
    await writeFile(repo, 'a.ts', 'export function a() { return 42 }\nexport function a2() {}\n')
    const now = Date.now() / 1000
    await fs.utimes(path.join(repo, 'a.ts'), now, now)
    const s3 = await index.update()
    expect(s3.updatedFiles).toBe(1)

    // Delete b.ts.
    await fs.rm(path.join(repo, 'b.ts'))
    const s4 = await index.update()
    expect(s4.files).toBe(1)
    const hits = index.search('function b')
    expect(hits.every((h) => h.path !== 'b.ts')).toBe(true)
  })

  it('round-trips through the cache and rebuilds on corruption', async () => {
    const fresh = new CodeIndex({ root: repo, cacheDir: cache })
    const loaded = await fresh.load()
    expect(loaded).toBe(true)
    expect(fresh.fileCount).toBe(1)

    // Corrupt the cache file.
    const files = await fs.readdir(cache)
    const cacheFile = path.join(cache, files.find((f) => f.endsWith('.json'))!)
    await fs.writeFile(cacheFile, '{ this is not json', 'utf8')

    const broken = new CodeIndex({ root: repo, cacheDir: cache })
    const ok = await broken.load()
    expect(ok).toBe(false)
    // Update rebuilds cleanly.
    const stats = await broken.update()
    expect(stats.files).toBe(1)
  })
})

describe('CodeIndex on the real repo src/', () => {
  let cache: string

  beforeAll(async () => {
    cache = await mkTmp('pawn-real-cache-')
  })
  afterAll(async () => {
    await fs.rm(cache, { recursive: true, force: true })
  })

  it("indexes real src/ and finds 'context compaction summary'", async () => {
    const repoRoot = path.resolve(__dirname, '../../../..')
    const srcRoot = path.join(repoRoot, 'src')
    const index = new CodeIndex({ root: srcRoot, cacheDir: cache })

    const t0 = Date.now()
    const stats = await index.update()
    const indexMs = Date.now() - t0
    // eslint-disable-next-line no-console
    console.log(`[codeIndex] indexed ${stats.files} files / ${stats.chunks} chunks in ${indexMs}ms`)

    const t1 = Date.now()
    const hits = index.search('context compaction summary', { limit: 10 })
    const searchMs = Date.now() - t1
    // eslint-disable-next-line no-console
    console.log(`[codeIndex] search took ${searchMs}ms`)

    expect(stats.files).toBeGreaterThan(50)
    expect(searchMs).toBeLessThan(500)
    const paths = hits.map((h) => h.path)
    expect(paths.some((p) => p.includes('agent/compaction.ts'))).toBe(true)
  }, 60000)
})
