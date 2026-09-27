import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { flattenSymbols, LspManager, normalizeWorkspaceEdit, symbolKindName } from '../lsp/manager'
import { resolveServer, SERVER_SPECS } from '../lsp/servers'
import { pathToFileURL } from 'url'

const uri = (p: string): string => pathToFileURL(p).href

describe('workspace edit + symbol conversions', () => {
  it('flattens `changes` and `documentChanges` (with resource operations)', () => {
    const a = normalizeWorkspaceEdit({
      changes: {
        [uri('/p/a.ts')]: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } }, newText: 'bar' }]
      }
    })
    expect(a.files).toEqual([{ path: '/p/a.ts', edits: [{ startLine: 1, startColumn: 5, endLine: 1, endColumn: 8, newText: 'bar' }] }])
    const b = normalizeWorkspaceEdit({
      documentChanges: [
        { textDocument: { uri: uri('/p/b.ts'), version: 2 }, edits: [{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, newText: 'x' }] },
        { kind: 'create', uri: uri('/p/new.ts') },
        { kind: 'rename', oldUri: uri('/p/old.ts'), newUri: uri('/p/renamed.ts') },
        { kind: 'delete', uri: uri('/p/gone.ts') }
      ]
    })
    expect(b.files[0].path).toBe('/p/b.ts')
    expect(b.creates).toEqual(['/p/new.ts'])
    expect(b.renames).toEqual([{ from: '/p/old.ts', to: '/p/renamed.ts' }])
    expect(b.deletes).toEqual(['/p/gone.ts'])
    expect(normalizeWorkspaceEdit(null)).toEqual({ files: [], creates: [], renames: [], deletes: [] })
  })

  it('flattens hierarchical document symbols and symbol information', () => {
    const doc = flattenSymbols(
      [
        {
          name: 'Cart',
          kind: 5,
          range: { start: { line: 0, character: 0 }, end: { line: 9, character: 1 } },
          selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } },
          children: [{ name: 'total', kind: 6, detail: '(): number', range: { start: { line: 2, character: 2 }, end: { line: 4, character: 3 } }, selectionRange: { start: { line: 2, character: 2 }, end: { line: 2, character: 7 } } }]
        }
      ],
      '/p/cart.ts'
    )
    expect(doc).toEqual([
      { name: 'Cart', kind: 'class', path: '/p/cart.ts', line: 1, column: 14, endLine: 10, depth: 0 },
      { name: 'total', kind: 'method', path: '/p/cart.ts', line: 3, column: 3, endLine: 5, detail: '(): number', container: 'Cart', depth: 1 }
    ])
    const ws = flattenSymbols([{ name: 'add', kind: 12, location: { uri: uri('/p/m.ts'), range: { start: { line: 4, character: 16 }, end: { line: 4, character: 19 } } }, containerName: 'math' }], '/x')
    expect(ws[0]).toEqual({ name: 'add', kind: 'function', path: '/p/m.ts', line: 5, column: 17, container: 'math' })
    expect(symbolKindName(999)).toBe('symbol')
  })
})

// Real typescript-language-server (skipped when not installed).
const tsServer = resolveServer(SERVER_SPECS[0], '/nonexistent-project-root')
describe.skipIf(!tsServer.command || !!tsServer.unavailable)('refactoring with typescript-language-server (real)', () => {
  let dir = ''
  const managers: LspManager[] = []
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pawn-lsp-refactor-'))
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler' }, include: ['*.ts'] }))
    writeFileSync(
      join(dir, 'lib.ts'),
      'export function computeTotal(items: number[]): number {\n  return items.reduce((a, b) => a + b, 0)\n}\n\nexport class Cart {\n  items: number[] = []\n  total(): number {\n    return computeTotal(this.items)\n  }\n}\n'
    )
    writeFileSync(join(dir, 'main.ts'), "import { computeTotal } from './lib'\n\nexport const t = computeTotal([1, 2, 3])\nexport function report(): string {\n  return String(computeTotal([4]))\n}\n")
    writeFileSync(join(dir, 'fix.ts'), 'export const c = new Cart()\n')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.disposeAll()))
  })

  it('renames a function across files, lists symbols, and walks the call hierarchy', async () => {
    const m = new LspManager()
    managers.push(m)
    const lib = join(dir, 'lib.ts')
    const main = join(dir, 'main.ts')
    // Let the project load so cross-file references are known.
    await m.diagnostics(dir, [lib, main], { waitMs: 6000 })

    const syms = await m.documentSymbols(dir, lib)
    expect(syms.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(['function:computeTotal', 'class:Cart', 'method:total']))

    const incoming = await m.callHierarchy(dir, lib, 1, 18, 'incoming')
    expect(incoming.error).toBeUndefined()
    expect(incoming.calls.map((c) => c.name)).toEqual(expect.arrayContaining(['total', 'report']))

    const outgoing = await m.callHierarchy(dir, lib, 7, 3, 'outgoing')
    expect(outgoing.calls.map((c) => c.name)).toContain('computeTotal')

    const r = await m.rename(dir, lib, 1, 18, 'sumItems')
    expect(r.error).toBeUndefined()
    const files = (r.edit?.files || []).map((f) => f.path.split('/').pop()).sort()
    expect(files).toEqual(['lib.ts', 'main.ts'])
    const mainEdits = r.edit!.files.find((f) => f.path.endsWith('main.ts'))!.edits
    expect(mainEdits.length).toBe(3) // import + two calls
    expect(mainEdits.every((e) => e.newText === 'sumItems')).toBe(true)
    // Nothing was written by the server — Pawn applies the edit itself.
    expect(readFileSync(main, 'utf8')).toContain('computeTotal')
  }, 60_000)

  it('offers and resolves a quick fix (add missing import)', async () => {
    const m = new LspManager()
    managers.push(m)
    const fix = join(dir, 'fix.ts')
    const listed = await m.codeActions(dir, fix, { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 })
    expect(listed.error).toBeUndefined()
    // Disabled refactorings are not offered.
    expect(listed.actions.every((a) => !a.disabled)).toBe(true)
    const fixAction = listed.actions.find((a) => a.kind === 'quickfix' && /import/i.test(a.title))
    expect(fixAction).toBeDefined()
    const applied = await m.applyCodeAction(dir, fix, fixAction!.index)
    expect(applied.error).toBeUndefined()
    const edits = applied.edit!.files.find((f) => f.path.endsWith('fix.ts'))!.edits
    const text = edits.map((e) => e.newText).join('')
    expect(text).toMatch(/import \{ Cart \} from ['"]\.\/lib['"]/)
    // The edit must not be applied twice (edit + command pushing the same edit).
    expect(text.match(/import \{ Cart \}/g)).toHaveLength(1)
  }, 60_000)

  it('runs a command-based refactoring and captures the edit the server pushes (extract constant)', async () => {
    const m = new LspManager()
    managers.push(m)
    const lib = join(dir, 'lib.ts')
    // `items.reduce((a, b) => a + b, 0)` on line 2
    const line = readFileSync(lib, 'utf8').split('\n')[1]
    const start = line.indexOf('items.reduce') + 1
    const end = line.length + 1
    const listed = await m.codeActions(dir, lib, { startLine: 2, startColumn: start, endLine: 2, endColumn: end })
    const extract = listed.actions.find((a) => a.kind?.startsWith('refactor.extract.constant'))
    expect(extract, JSON.stringify(listed.actions.map((a) => a.kind))).toBeDefined()
    const applied = await m.applyCodeAction(dir, lib, extract!.index)
    expect(applied.error).toBeUndefined()
    const edits = applied.edit!.files.find((f) => f.path.endsWith('lib.ts'))?.edits || []
    expect(edits.length).toBeGreaterThan(0)
    expect(edits.map((e) => e.newText).join('')).toMatch(/const \w+ = items\.reduce/)
  }, 60_000)
})
