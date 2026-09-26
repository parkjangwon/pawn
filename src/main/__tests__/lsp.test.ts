import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MessageDecoder, encodeMessage } from '../lsp/jsonrpc'
import { findProjectRoot, resolveCommand, resolveServer, SERVER_SPECS, specForPath } from '../lsp/servers'
import { LspManager, convertDiagnostic, hoverText, normalizeLocations, type SpawnFn } from '../lsp/manager'

/**
 * Tiny LSP server: publishes one error per line containing "ERROR", answers
 * definition with line 1 of the same file and references with every line
 * containing the word under the cursor.
 */
const MOCK_SERVER = String.raw`
let buf = Buffer.alloc(0)
const docs = new Map()
function send(msg) {
  const body = Buffer.from(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, msg)))
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n')
  process.stdout.write(body)
}
function publish(uri) {
  const text = docs.get(uri) || ''
  const diagnostics = []
  text.split('\n').forEach((l, i) => {
    const c = l.indexOf('ERROR')
    if (c >= 0) diagnostics.push({ range: { start: { line: i, character: c }, end: { line: i, character: c + 5 } }, severity: 1, message: 'bad thing', source: 'mock', code: 42 })
    const w = l.indexOf('WARN')
    if (w >= 0) diagnostics.push({ range: { start: { line: i, character: w }, end: { line: i, character: w + 4 } }, severity: 2, message: 'meh' })
  })
  // Like real servers: an empty set first, then the result.
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } })
  setTimeout(() => send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } }), 60)
}
function handle(m) {
  if (m.method === 'initialize') {
    // Server-initiated request the client must answer.
    send({ id: 900, method: 'workspace/configuration', params: { items: [{}, {}] } })
    return send({ id: m.id, result: { capabilities: { textDocumentSync: 1 } } })
  }
  if (m.method === 'textDocument/didOpen') { docs.set(m.params.textDocument.uri, m.params.textDocument.text); return publish(m.params.textDocument.uri) }
  if (m.method === 'textDocument/didChange') { docs.set(m.params.textDocument.uri, m.params.contentChanges[0].text); return publish(m.params.textDocument.uri) }
  if (m.method === 'textDocument/definition') return send({ id: m.id, result: [{ targetUri: m.params.textDocument.uri, targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, targetSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }] })
  if (m.method === 'textDocument/references') {
    const text = docs.get(m.params.textDocument.uri) || ''
    const lines = text.split('\n')
    const line = lines[m.params.position.line] || ''
    const word = (line.slice(m.params.position.character).match(/^\w+/) || [''])[0]
    const result = []
    lines.forEach((l, i) => { const c = l.indexOf(word); if (word && c >= 0) result.push({ uri: m.params.textDocument.uri, range: { start: { line: i, character: c }, end: { line: i, character: c + word.length } } }) })
    return send({ id: m.id, result })
  }
  if (m.method === 'textDocument/hover') return send({ id: m.id, result: { contents: { kind: 'markdown', value: '**hover**' } } })
  if (m.method === 'shutdown') return send({ id: m.id, result: null })
  if (m.method === 'exit') process.exit(0)
}
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const i = buf.indexOf('\r\n\r\n')
    if (i < 0) return
    const len = Number(/Content-Length: (\d+)/i.exec(buf.slice(0, i).toString())[1])
    if (buf.length < i + 4 + len) return
    const msg = JSON.parse(buf.slice(i + 4, i + 4 + len).toString())
    buf = buf.slice(i + 4 + len)
    handle(msg)
  }
})
`

let dir = ''
let serverScript = ''
const managers: LspManager[] = []

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pawn-lsp-'))
  serverScript = join(dir, 'mock-server.cjs')
  writeFileSync(serverScript, MOCK_SERVER)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disposeAll()))
})

function mockManager(): LspManager {
  const spawnFn: SpawnFn = (_cmd, _args, opts) =>
    spawn(process.execPath, [serverScript], { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const m = new LspManager(spawnFn, (spec) => ({ spec, command: 'mock-lsp', initializationOptions: {} }))
  managers.push(m)
  return m
}

describe('jsonrpc framing', () => {
  it('decodes messages split across chunks and skips garbage', () => {
    const a = encodeMessage({ jsonrpc: '2.0', id: 1, result: { ok: 'héllo' } })
    const b = encodeMessage({ jsonrpc: '2.0', method: 'x', params: [1] })
    const all = Buffer.concat([Buffer.from('noise\r\n\r\n'), a, b])
    const d = new MessageDecoder()
    const out = [...d.push(all.subarray(0, 20)), ...d.push(all.subarray(20, 57)), ...d.push(all.subarray(57))]
    expect(out).toEqual([
      { jsonrpc: '2.0', id: 1, result: { ok: 'héllo' } },
      { jsonrpc: '2.0', method: 'x', params: [1] }
    ])
  })
})

describe('server discovery', () => {
  it('maps extensions to servers', () => {
    expect(specForPath('/p/a.tsx')?.language).toBe('typescript')
    expect(specForPath('/p/a.py')?.language).toBe('python')
    expect(specForPath('/p/a.rs')?.language).toBe('rust')
    expect(specForPath('/p/README.md')).toBeNull()
  })

  it('finds the nearest project root inside the workspace', () => {
    const ws = join(dir, 'ws')
    mkdirSync(join(ws, 'packages', 'app', 'src'), { recursive: true })
    writeFileSync(join(ws, 'packages', 'app', 'tsconfig.json'), '{}')
    const file = join(ws, 'packages', 'app', 'src', 'index.ts')
    expect(findProjectRoot(file, ['tsconfig.json'], ws)).toBe(join(ws, 'packages', 'app'))
    expect(findProjectRoot(join(ws, 'x.ts'), ['tsconfig.json'], ws)).toBe(ws)
    // Outside the workspace → the workspace itself (never walks above it).
    expect(findProjectRoot('/elsewhere/a.ts', ['tsconfig.json'], ws)).toBe(ws)
  })

  it('never resolves executables from inside the project', () => {
    const project = join(dir, 'proj')
    const bin = join(project, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    const exe = join(bin, 'pawn-fake-lsp')
    writeFileSync(exe, '#!/bin/sh\n')
    chmodSync(exe, 0o755)
    expect(resolveCommand('pawn-fake-lsp', undefined, bin)).toBe(exe)
    expect(resolveCommand('pawn-fake-lsp', project, bin)).toBeNull()
  })

  it('reports an install hint when the server is missing', () => {
    const spec = { ...SERVER_SPECS[1], commands: ['definitely-not-installed-lsp'] }
    const r = resolveServer(spec, dir)
    expect(r.command).toBeNull()
    expect(r.unavailable).toContain('npm install -g pyright')
  })
})

describe('conversions', () => {
  it('converts diagnostics to 1-based positions', () => {
    expect(
      convertDiagnostic({
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } },
        severity: 2,
        message: ' msg ',
        code: { value: 'E1' }
      })
    ).toEqual({ line: 1, column: 5, endLine: 1, endColumn: 10, severity: 'warning', message: 'msg', code: 'E1' })
  })

  it('normalizes Location / LocationLink results and hover contents', () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } }
    expect(normalizeLocations({ uri: 'file:///a', range })).toHaveLength(1)
    expect(normalizeLocations([{ targetUri: 'file:///b', targetRange: range }])[0].uri).toBe('file:///b')
    expect(normalizeLocations(null)).toEqual([])
    expect(hoverText({ contents: [{ language: 'ts', value: 'x: number' }, 'doc'] })).toBe('```ts\nx: number\n```\n\ndoc')
  })
})

describe('LspManager with a mock server', () => {
  it('opens files, waits past the empty first publish, and reports diagnostics', async () => {
    const m = mockManager()
    const file = join(dir, 'a.ts')
    writeFileSync(file, 'const a = 1\nconst b = ERROR\n')
    const res = await m.diagnostics(dir, [file], { waitMs: 3000 })
    expect(res.errors).toEqual([])
    expect(res.files[0].diagnostics).toEqual([
      expect.objectContaining({ line: 2, column: 11, severity: 'error', message: 'bad thing', code: 42 })
    ])
    expect(res.files[0].fresh).toBe(true)
  })

  it('syncs unsaved content and re-checks after changes', async () => {
    const m = mockManager()
    const file = join(dir, 'b.ts')
    writeFileSync(file, 'ok\n')
    expect((await m.diagnostics(dir, [file], { waitMs: 3000 })).files[0].diagnostics).toEqual([])
    const r = await m.diagnostics(dir, [file], { waitMs: 3000, content: { [file]: 'ok\nERROR here\nWARN\n' } })
    expect(r.files[0].diagnostics.map((d) => d.severity)).toEqual(['error', 'warning'])
  })

  it('answers definition, references, and hover', async () => {
    const m = mockManager()
    const file = join(dir, 'c.ts')
    writeFileSync(file, 'foo()\nbar()\nfoo()\n')
    const def = await m.locations('textDocument/definition', dir, file, 3, 1)
    expect(def.locations).toEqual([expect.objectContaining({ path: file, line: 1, column: 1, preview: 'foo()' })])
    const refs = await m.locations('textDocument/references', dir, file, 1, 1)
    expect(refs.locations.map((l) => l.line)).toEqual([1, 3])
    expect((await m.hover(dir, file, 1, 1)).text).toBe('**hover**')
  })

  it('skips unsupported files and reports status', async () => {
    const m = mockManager()
    const res = await m.diagnostics(dir, [join(dir, 'notes.md')], { waitMs: 100 })
    expect(res.unsupported).toHaveLength(1)
    const file = join(dir, 'd.ts')
    writeFileSync(file, 'x\n')
    await m.diagnostics(dir, [file], { waitMs: 500 })
    expect(m.status(dir)).toEqual([expect.objectContaining({ language: 'typescript', state: 'ready' })])
  })

  it('does nothing while disabled', async () => {
    const m = mockManager()
    m.setEnabled(false)
    const file = join(dir, 'e.ts')
    writeFileSync(file, 'ERROR\n')
    const res = await m.diagnostics(dir, [file], { waitMs: 100 })
    expect(res.files).toEqual([])
    expect(res.errors[0]).toContain('disabled')
  })
})

// Real typescript-language-server end-to-end (skipped when not installed).
const tsServer = resolveServer(SERVER_SPECS[0], '/nonexistent-project-root')
describe.skipIf(!tsServer.command || !!tsServer.unavailable)('typescript-language-server (real)', () => {
  it('reports a type error and finds a definition', async () => {
    const m = new LspManager()
    managers.push(m)
    const proj = join(dir, 'real-ts')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }))
    writeFileSync(join(proj, 'lib.ts'), 'export function add(a: number, b: number): number {\n  return a + b\n}\n')
    const main = join(proj, 'main.ts')
    writeFileSync(main, "import { add } from './lib'\nconst n: string = add(1, 2)\nexport { n }\n")
    const res = await m.diagnostics(proj, [main], { waitMs: 8000 })
    const errs = res.files[0]?.diagnostics.filter((d) => d.severity === 'error') ?? []
    expect(errs.length).toBeGreaterThan(0)
    expect(errs[0].line).toBe(2)
    const def = await m.locations('textDocument/definition', proj, main, 2, 20)
    expect(def.locations[0]?.path.endsWith('lib.ts')).toBe(true)
  }, 40_000)
})
