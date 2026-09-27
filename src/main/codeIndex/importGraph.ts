/**
 * Reverse import graph for a repository.
 *
 * Parses import statements for TS/JS, Python, and Go, resolves specifiers to
 * concrete files on disk, and records both forward edges (file -> imported
 * files) and reverse edges (file -> files that import it). Supports tsconfig
 * baseUrl + simple path aliases, extension inference, /index resolution, and
 * the TS ESM `.js`->`.ts` rewrite convention.
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

export interface ImportGraph {
  root: string
  // reverse[importedFile] = set of files that import it (all repo-relative, / separators)
  reverse: Map<string, Set<string>>
  // forward[file] = set of files it imports
  forward: Map<string, Set<string>>
  files: string[]
  mtimes: Map<string, number>
  tsPaths: TsPaths | null
  goModule: string | null
}

interface TsPaths {
  baseUrl: string // absolute
  paths: Array<{ prefix: string; targets: string[] }>
}

const SKIP_DIRS = new Set<string>([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next',
  'target', 'vendor', '__pycache__', '.venv', 'venv'
])

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      if (e.name.startsWith('.') && e.name !== '.github') continue
      await walk(root, abs, out)
    } else if (e.isFile()) {
      out.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
}

/** Strip // and /* comments and trailing commas so JSON.parse tolerates tsconfig. */
function parseJsonc<T>(raw: string): T | null {
  try {
    const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1')
    const noTrailing = noLine.replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(noTrailing) as T
  } catch {
    return null
  }
}

async function loadTsPaths(root: string): Promise<TsPaths | null> {
  let candidates: string[]
  try {
    candidates = (await fs.readdir(root))
      .filter((f) => /^tsconfig.*\.json$/.test(f))
  } catch {
    return null
  }
  for (const file of candidates) {
    let raw: string
    try {
      raw = await fs.readFile(path.join(root, file), 'utf8')
    } catch {
      continue
    }
    const cfg = parseJsonc<{
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
    }>(raw)
    const co = cfg?.compilerOptions
    if (!co) continue
    if (co.baseUrl || co.paths) {
      const baseUrl = path.resolve(root, co.baseUrl || '.')
      const paths: TsPaths['paths'] = []
      for (const [k, v] of Object.entries(co.paths || {})) {
        paths.push({ prefix: k.replace(/\*$/, ''), targets: v.map((t) => t.replace(/\*$/, '')) })
      }
      return { baseUrl, paths }
    }
  }
  return null
}

async function loadGoModule(root: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(root, 'go.mod'), 'utf8')
    const m = /^module\s+(\S+)/m.exec(raw)
    return m ? m[1] : null
  } catch {
    return null
  }
}

const IMPORT_RES: RegExp[] = [
  /import\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /export\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  /(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]/g
]

function extractSpecifiers(content: string): string[] {
  const out = new Set<string>()
  for (const re of IMPORT_RES) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      out.add(m[1])
    }
  }
  return Array.from(out)
}

function extractPython(content: string): string[] {
  const out = new Set<string>()
  const re1 = /^\s*import\s+([A-Za-z0-9_.]+)/gm
  const re2 = /^\s*from\s+(\.*[A-Za-z0-9_.]*)\s+import\s+/gm
  let m: RegExpExecArray | null
  while ((m = re1.exec(content)) !== null) out.add(m[1])
  while ((m = re2.exec(content)) !== null) out.add(m[1])
  return Array.from(out)
}

function extractGo(content: string): string[] {
  const out = new Set<string>()
  const block = /import\s*\(([\s\S]*?)\)/g
  let m: RegExpExecArray | null
  while ((m = block.exec(content)) !== null) {
    const lineRe = /["']([^"']+)["']/g
    let lm: RegExpExecArray | null
    while ((lm = lineRe.exec(m[1])) !== null) out.add(lm[1])
  }
  const single = /^\s*import\s+["']([^"']+)["']/gm
  while ((m = single.exec(content)) !== null) out.add(m[1])
  return Array.from(out)
}

function fileExists(fileSet: Set<string>, rel: string): string | null {
  return fileSet.has(rel) ? rel : null
}

/** Resolve a JS/TS relative or aliased specifier to a repo-relative file. */
function resolveTsSpecifier(
  fromRel: string,
  spec: string,
  root: string,
  fileSet: Set<string>,
  tsPaths: TsPaths | null
): string | null {
  let baseAbs: string | null = null

  if (spec.startsWith('.')) {
    baseAbs = path.resolve(root, path.dirname(fromRel), spec)
  } else if (tsPaths) {
    // try alias paths
    for (const p of tsPaths.paths) {
      if (spec === p.prefix.replace(/\/$/, '') || spec.startsWith(p.prefix)) {
        const rest = spec.slice(p.prefix.length)
        for (const target of p.targets) {
          const cand = path.resolve(tsPaths.baseUrl, target + rest)
          const r = resolveAbs(cand, root, fileSet)
          if (r) return r
        }
      }
    }
    // baseUrl bare import
    baseAbs = path.resolve(tsPaths.baseUrl, spec)
  } else {
    return null
  }
  return resolveAbs(baseAbs, root, fileSet)
}

function resolveAbs(baseAbs: string, root: string, fileSet: Set<string>): string | null {
  const toRel = (abs: string): string => path.relative(root, abs).split(path.sep).join('/')
  const candidates: string[] = []

  // .js -> .ts rewrite convention
  const rewritten = baseAbs.replace(/\.(js|jsx|mjs|cjs)$/, '')
  const hadJsExt = rewritten !== baseAbs

  const bases = hadJsExt ? [rewritten] : [baseAbs]
  for (const b of bases) {
    // exact (already has ext)
    candidates.push(b)
    for (const ext of TS_EXTS) candidates.push(b + ext)
    for (const ext of TS_EXTS) candidates.push(path.join(b, 'index' + ext))
  }
  for (const c of candidates) {
    const rel = toRel(c)
    if (fileSet.has(rel)) return rel
  }
  return null
}

/** Resolve a Python module spec to a repo-relative file. */
function resolvePython(
  fromRel: string,
  spec: string,
  root: string,
  fileSet: Set<string>
): string | null {
  const roots = ['', 'src/']
  // relative import: leading dots
  if (spec.startsWith('.')) {
    let dots = 0
    while (spec[dots] === '.') dots++
    const rest = spec.slice(dots).replace(/\./g, '/')
    let dir = path.dirname(fromRel)
    for (let i = 1; i < dots; i++) dir = path.dirname(dir)
    const baseRel = (dir === '.' ? '' : dir + '/') + rest
    return tryPyFile(baseRel, fileSet)
  }
  const asPath = spec.replace(/\./g, '/')
  for (const r of roots) {
    const hit = tryPyFile(r + asPath, fileSet)
    if (hit) return hit
    // maybe last segment is a symbol: drop it
    const parts = asPath.split('/')
    if (parts.length > 1) {
      const hit2 = tryPyFile(r + parts.slice(0, -1).join('/'), fileSet)
      if (hit2) return hit2
    }
  }
  return null
}

function tryPyFile(baseRel: string, fileSet: Set<string>): string | null {
  baseRel = baseRel.replace(/\/+$/, '')
  return (
    fileExists(fileSet, baseRel + '.py') ||
    fileExists(fileSet, baseRel + '/__init__.py')
  )
}

/** Build the import graph. Fast full build; caller caches with mtime invalidation. */
export async function buildImportGraph(root: string): Promise<ImportGraph> {
  const absRoot = path.resolve(root)
  const files: string[] = []
  await walk(absRoot, absRoot, files)
  const fileSet = new Set(files)
  const tsPaths = await loadTsPaths(absRoot)
  const goModule = await loadGoModule(absRoot)

  const forward = new Map<string, Set<string>>()
  const reverse = new Map<string, Set<string>>()
  const mtimes = new Map<string, number>()

  const addEdge = (from: string, to: string): void => {
    if (from === to) return
    let f = forward.get(from)
    if (!f) forward.set(from, (f = new Set()))
    f.add(to)
    let r = reverse.get(to)
    if (!r) reverse.set(to, (r = new Set()))
    r.add(from)
  }

  // Go: map import path -> dir, dir -> files.
  const goDirImportPath = new Map<string, string>() // dir(rel) -> importpath
  if (goModule) {
    for (const f of files) {
      if (!f.endsWith('.go')) continue
      const dir = path.dirname(f)
      const imp = dir === '.' ? goModule : `${goModule}/${dir}`
      goDirImportPath.set(dir, imp)
    }
  }
  const goImportPathDir = new Map<string, string>()
  for (const [dir, imp] of Array.from(goDirImportPath.entries())) goImportPathDir.set(imp, dir)

  for (const rel of files) {
    const ext = (/(\.[^.]+)$/.exec(rel)?.[1] || '').toLowerCase()
    const abs = path.join(absRoot, rel)
    try {
      const st = await fs.stat(abs)
      mtimes.set(rel, st.mtimeMs)
    } catch {
      // ignore
    }
    let content: string
    try {
      content = await fs.readFile(abs, 'utf8')
    } catch {
      continue
    }

    if (['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      for (const spec of extractSpecifiers(content)) {
        const target = resolveTsSpecifier(rel, spec, absRoot, fileSet, tsPaths)
        if (target) addEdge(rel, target)
      }
    } else if (ext === '.py') {
      for (const spec of extractPython(content)) {
        const target = resolvePython(rel, spec, absRoot, fileSet)
        if (target) addEdge(rel, target)
      }
    } else if (ext === '.go' && goModule) {
      const dir = path.dirname(rel)
      for (const imp of extractGo(content)) {
        const targetDir = goImportPathDir.get(imp)
        if (targetDir !== undefined && targetDir !== dir) {
          // this file imports the package in targetDir: edge from every file
          // in targetDir is not what we want; instead record dir-level edge by
          // linking this file to all files in targetDir.
          for (const f of files) {
            if (f.endsWith('.go') && path.dirname(f) === targetDir) addEdge(rel, f)
          }
        }
      }
    }
  }

  return { root: absRoot, reverse, forward, files, mtimes, tsPaths, goModule }
}

export { TS_EXTS }
