/**
 * Affected-test selection.
 *
 * Given a set of changed files, walks the reverse import graph to find test
 * files that (transitively) import them, plus name-matched and directly-changed
 * tests, then emits runner commands (vitest/jest/mocha/pytest/go/cargo).
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import { buildImportGraph, type ImportGraph } from './importGraph'

export type Runner = 'vitest' | 'jest' | 'mocha' | 'pytest' | 'go' | 'cargo' | 'npm'
export type Reason = 'is-test' | 'name-match' | 'imports'

export interface AffectedTest {
  path: string
  reason: Reason
  via?: string
  depth?: number
}

export interface RunnerCommand {
  runner: Runner
  command: string
  tests: string[]
}

export interface AffectedResult {
  tests: AffectedTest[]
  commands: RunnerCommand[]
  notes: string[]
}

export interface FindOptions {
  maxDepth?: number
  limit?: number
}

function isJsTest(rel: string): boolean {
  return /(\.test\.|\.spec\.)/.test(rel) ||
    /(^|\/)__tests__\//.test(rel) ||
    /(^|\/)tests?\//.test(rel)
}

function isPyTest(rel: string): boolean {
  const base = rel.split('/').pop() || ''
  return /^test_.*\.py$/.test(base) || /_test\.py$/.test(base) || /(^|\/)tests?\//.test(rel)
}

function isGoTest(rel: string): boolean {
  return /_test\.go$/.test(rel)
}

export function isTestFile(rel: string): boolean {
  if (rel.endsWith('.py')) return isPyTest(rel)
  if (rel.endsWith('.go')) return isGoTest(rel)
  return isJsTest(rel)
}

/** Candidate test filenames that would test a given source file (name-match). */
function nameMatchCandidates(rel: string): string[] {
  const dir = path.dirname(rel)
  const base = path.basename(rel)
  const out: string[] = []
  const jsExt = /\.([tj]sx?|mts|cts|mjs|cjs)$/.exec(base)
  if (jsExt) {
    const stem = base.slice(0, base.length - jsExt[0].length)
    const ext = jsExt[1]
    for (const t of ['test', 'spec']) {
      out.push(join(dir, `${stem}.${t}.${ext}`))
      out.push(join(dir, '__tests__', `${stem}.${t}.${ext}`))
      out.push(join(dir, '__tests__', `${stem}.${ext}`))
    }
  } else if (base.endsWith('.py')) {
    const stem = base.slice(0, -3)
    out.push(join(dir, `test_${stem}.py`))
    out.push(join(dir, `${stem}_test.py`))
    out.push(join(dir, 'tests', `test_${stem}.py`))
  } else if (base.endsWith('.go')) {
    const stem = base.slice(0, -3)
    out.push(join(dir, `${stem}_test.go`))
  }
  return out
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function toRel(root: string, f: string): string {
  const abs = path.isAbsolute(f) ? f : path.join(root, f)
  return path.relative(root, abs).split(path.sep).join('/')
}

interface RunnerDetection {
  vitest: boolean
  jest: boolean
  mocha: boolean
  pytest: boolean
  go: boolean
  cargo: boolean
}

async function detectRunners(root: string): Promise<RunnerDetection> {
  const det: RunnerDetection = {
    vitest: false, jest: false, mocha: false, pytest: false, go: false, cargo: false
  }
  try {
    const pkgRaw = await fs.readFile(path.join(root, 'package.json'), 'utf8')
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    const blob = JSON.stringify({
      d: pkg.dependencies, dd: pkg.devDependencies, s: pkg.scripts
    })
    if (/vitest/.test(blob)) det.vitest = true
    if (/jest/.test(blob)) det.jest = true
    if (/mocha/.test(blob)) det.mocha = true
  } catch {
    // no package.json
  }
  for (const f of ['pyproject.toml', 'pytest.ini', 'setup.cfg']) {
    if (await exists(path.join(root, f))) det.pytest = true
  }
  try {
    const reqs = (await fs.readdir(root)).filter((f) => /^requirements.*\.txt$/.test(f))
    if (reqs.length) det.pytest = true
  } catch {
    // ignore
  }
  if (await exists(path.join(root, 'go.mod'))) det.go = true
  if (await exists(path.join(root, 'Cargo.toml'))) det.cargo = true
  return det
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Find tests affected by the given changed files.
 * @param graph optionally reuse a prebuilt graph (skips rebuild).
 */
export async function findAffectedTests(
  root: string,
  changedFiles: string[],
  opts: FindOptions = {},
  graph?: ImportGraph
): Promise<AffectedResult> {
  const absRoot = path.resolve(root)
  const maxDepth = opts.maxDepth ?? 4
  const limit = opts.limit ?? 50
  const notes: string[] = []

  const g = graph || (await getCachedGraph(absRoot))
  const fileSet = new Set(g.files)

  const changed = changedFiles.map((f) => toRel(absRoot, f))
  const found = new Map<string, AffectedTest>()

  const consider = (t: AffectedTest): void => {
    const prev = found.get(t.path)
    if (!prev || (t.depth ?? 0) < (prev.depth ?? 0)) found.set(t.path, t)
  }

  // Go tests live in the same package/directory as the code they test. Collect
  // every Go source dir reached (changed file or transitively-importing file)
  // and add its _test.go files.
  const goDirs = new Set<string>()
  const addGoDir = (rel: string): void => {
    if (rel.endsWith('.go')) goDirs.add(path.dirname(rel))
  }

  for (const c of changed) {
    // Directly-changed test files.
    if (isTestFile(c)) {
      consider({ path: c, reason: 'is-test', depth: 0 })
    }
    addGoDir(c)
    // Name-match candidates.
    for (const cand of nameMatchCandidates(c)) {
      if (fileSet.has(cand)) consider({ path: cand, reason: 'name-match', via: c, depth: 0 })
    }
    // Reverse-import BFS.
    const visited = new Set<string>([c])
    let frontier: Array<{ file: string; via: string }> = [{ file: c, via: c }]
    for (let depth = 1; depth <= maxDepth; depth++) {
      const next: Array<{ file: string; via: string }> = []
      for (const { file } of frontier) {
        const importers = g.reverse.get(file)
        if (!importers) continue
        for (const imp of Array.from(importers)) {
          if (visited.has(imp)) continue
          visited.add(imp)
          if (isTestFile(imp)) {
            consider({ path: imp, reason: 'imports', via: file, depth })
          } else {
            addGoDir(imp)
          }
          next.push({ file: imp, via: file })
        }
      }
      if (!next.length) break
      frontier = next
    }
  }

  // Add _test.go files in every affected Go package directory.
  if (goDirs.size) {
    for (const f of g.files) {
      if (!f.endsWith('_test.go')) continue
      if (goDirs.has(path.dirname(f))) {
        consider({ path: f, reason: 'imports', via: path.dirname(f), depth: 1 })
      }
    }
  }

  let tests = Array.from(found.values())
  tests.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.path.localeCompare(b.path))
  if (tests.length > limit) {
    notes.push(`Truncated to ${limit} of ${tests.length} affected tests.`)
    tests = tests.slice(0, limit)
  }

  const det = await detectRunners(absRoot)
  const commands = buildCommands(tests, det, notes)

  return { tests, commands, notes }
}

function buildCommands(
  tests: AffectedTest[],
  det: RunnerDetection,
  notes: string[]
): RunnerCommand[] {
  const commands: RunnerCommand[] = []
  const jsTests = tests.filter((t) => /\.[tj]sx?$|\.mts$|\.cts$|\.mjs$|\.cjs$/.test(t.path)).map((t) => t.path)
  const pyTests = tests.filter((t) => t.path.endsWith('.py')).map((t) => t.path)
  const goTests = tests.filter((t) => t.path.endsWith('.go')).map((t) => t.path)

  if (jsTests.length) {
    if (det.vitest) {
      commands.push({ runner: 'vitest', command: `npx vitest run ${jsTests.join(' ')}`, tests: jsTests })
    } else if (det.jest) {
      commands.push({ runner: 'jest', command: `npx jest ${jsTests.join(' ')}`, tests: jsTests })
    } else if (det.mocha) {
      commands.push({ runner: 'mocha', command: `npx mocha ${jsTests.join(' ')}`, tests: jsTests })
    } else {
      commands.push({ runner: 'npm', command: `npm test`, tests: jsTests })
      notes.push('No JS test runner detected; falling back to `npm test`.')
    }
  }
  if (pyTests.length) {
    if (det.pytest) {
      commands.push({ runner: 'pytest', command: `python -m pytest ${pyTests.join(' ')}`, tests: pyTests })
    } else {
      commands.push({ runner: 'pytest', command: `python -m pytest ${pyTests.join(' ')}`, tests: pyTests })
      notes.push('pytest config not found; assuming pytest is available.')
    }
  }
  if (goTests.length) {
    const dirs = Array.from(new Set(goTests.map((t) => './' + (path.dirname(t) || '.'))))
    commands.push({ runner: 'go', command: `go test ${dirs.join(' ')}`, tests: goTests })
  }
  return commands
}

/** Render an affected-test result as compact text. */
export function formatAffectedTests(result: AffectedResult): string {
  const out: string[] = []
  out.push(`Affected tests: ${result.tests.length}`)
  for (const t of result.tests) {
    const via = t.via ? `  (via ${t.via})` : ''
    const depth = t.depth !== undefined ? ` d${t.depth}` : ''
    out.push(`  ${t.path}  [${t.reason}${depth}]${via}`)
  }
  if (result.commands.length) {
    out.push('Commands:')
    for (const c of result.commands) out.push(`  ${c.command}`)
  }
  for (const n of result.notes) out.push(`note: ${n}`)
  return out.join('\n')
}

// --- cached graph per root with mtime invalidation ---

interface CacheEntry {
  graph: ImportGraph
  signature: string
}
const graphCache = new Map<string, CacheEntry>()

async function computeSignature(root: string): Promise<string> {
  // Cheap signature: newest mtime + file count over a quick walk.
  const graphFiles = graphCache.get(root)?.graph.files
  if (!graphFiles) return ''
  let maxM = 0
  let count = 0
  for (const rel of graphFiles) {
    try {
      const st = await fs.stat(path.join(root, rel))
      if (st.mtimeMs > maxM) maxM = st.mtimeMs
      count++
    } catch {
      // deleted -> signature will differ
    }
  }
  return `${count}:${maxM}`
}

async function getCachedGraph(root: string): Promise<ImportGraph> {
  const cached = graphCache.get(root)
  if (cached) {
    const sig = await computeSignature(root)
    if (sig === cached.signature) return cached.graph
  }
  const graph = await buildImportGraph(root)
  let maxM = 0
  for (const m of Array.from(graph.mtimes.values())) if (m > maxM) maxM = m
  graphCache.set(root, { graph, signature: `${graph.files.length}:${maxM}` })
  return graph
}

export { getCachedGraph }
