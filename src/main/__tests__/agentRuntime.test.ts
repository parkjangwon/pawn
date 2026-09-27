import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'net'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatRuntimeEvents, parseConsoleMessage, RuntimeEventLog } from '../browserRuntime'
import { createAgentRuntime, probePort, readOutputSlice, validProjectRoot } from '../agentRuntime'

describe('browser runtime event log', () => {
  it('keeps per-tab events with a global sequence, filters and collapses repeats', () => {
    const log = new RuntimeEventLog()
    log.push('t1', { kind: 'console', level: 'info', text: 'hello' })
    const seq2 = log.push('t1', { kind: 'exception', level: 'error', text: 'Uncaught TypeError: x is undefined', source: 'app.js:3' }).seq
    log.push('t2', { kind: 'network', level: 'error', text: 'xhr', url: 'http://localhost/api', status: 500, method: 'POST' })
    log.push('t1', { kind: 'exception', level: 'error', text: 'Uncaught TypeError: x is undefined', source: 'app.js:3' })
    expect(log.events('t1')).toHaveLength(2)
    expect((log.events('t1')[1] as { repeat?: number }).repeat).toBe(2)
    expect(log.events('t1', { minLevel: 'warn' }).map((e) => e.kind)).toEqual(['exception'])
    expect(log.events('t1', { since: seq2 }).length).toBe(1) // the repeat bumped the seq
    expect(log.events('t2', { kinds: ['network'] })[0].status).toBe(500)
    expect(formatRuntimeEvents(log.events('t2'))).toContain('[POST 500] http://localhost/api')
    expect(formatRuntimeEvents(log.events('t1', { minLevel: 'error' }))).toContain('×2')
    log.clear('t1')
    expect(log.events('t1')).toEqual([])
  })

  it('parses both console-message signatures', () => {
    expect(parseConsoleMessage([{ level: 'error', message: 'boom', lineNumber: 4, sourceId: 'a.js' }])).toEqual({ level: 'error', message: 'boom', source: 'a.js:4' })
    expect(parseConsoleMessage([{}, 2, 'careful', 9, 'b.js'])).toEqual({ level: 'warn', message: 'careful', source: 'b.js:9' })
    expect(parseConsoleMessage([{}, 0, 'fine']).level).toBe('info')
  })
})

describe('agent runtime services', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pawn-rt-'))
  const rt = createAgentRuntime({ pawnDir: null, indexDir: join(dir, 'idx') })
  let server: Server | null = null
  afterAll(async () => {
    await rt.dispose()
    server?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('pages, greps and tails saved outputs', async () => {
    const text = Array.from({ length: 500 }, (_, i) => `line ${i + 1}${i === 349 ? ' ERROR disk full' : ''}`).join('\n')
    expect(readOutputSlice(text, { offset: 10, limit: 3 })).toContain('lines 10-12 of 500')
    expect(readOutputSlice(text, { grep: 'error', context: 1 })).toMatch(/1 matching line of 500:\n\s+349\s+line 349\n\s+350\s+line 350 ERROR disk full\n\s+351/)
    expect(readOutputSlice(text, { tail: 2 })).toContain('499-500')
    expect(readOutputSlice(text, { grep: '[' })).toContain('No lines match') // invalid regex → literal
    const saved = await rt.outputs.save('s1', text)
    expect(saved.ok).toBe(true)
    const id = (saved as { id: string }).id
    expect(id).toMatch(/^out_[0-9a-f]{8}$/)
    const read = await rt.outputs.read(id, { grep: 'disk full' })
    expect(read).toMatchObject({ ok: true })
    expect((read as { text: string }).text).toContain('350')
    expect((await rt.outputs.read('out_00000000')).ok).toBe(false)
    expect((await rt.outputs.read('../etc/passwd')).ok).toBe(false)
  })

  it('probes local ports only', async () => {
    server = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => server!.once('listening', r))
    const port = (server.address() as { port: number }).port
    expect(await probePort(port)).toBe(true)
    expect((await rt.net.probePort(port, 'localhost')).open).toBe(true)
    expect(await probePort(1)).toBe(false)
    expect(await probePort(port, 'example.com')).toBe(false)
  })

  it('validates project roots and stores profiles', async () => {
    expect(validProjectRoot('/')).toBeNull()
    expect(validProjectRoot('relative/path')).toBeNull()
    expect(validProjectRoot(dir)).toBe(dir)
    expect(await rt.profile.get(dir)).toEqual({ ok: true, json: null })
    expect((await rt.profile.save(dir, '{not json')).ok).toBe(false)
    expect((await rt.profile.save(dir, JSON.stringify({ version: 1 }))).ok).toBe(true)
    expect((await rt.profile.get(dir)).json).toBe('{"version":1}')
  })

  it('runs a persistent bash session, semantic search and affected tests', async () => {
    const proj = join(dir, 'proj')
    mkdirSync(join(proj, 'src', '__tests__'), { recursive: true })
    writeFileSync(join(proj, 'package.json'), JSON.stringify({ devDependencies: { vitest: '1' } }))
    writeFileSync(join(proj, 'src', 'retry.ts'), 'export function fetchWithBackoff(url: string, attempts = 3) {\n  // retry failed requests with exponential backoff\n  return url + attempts\n}\n')
    writeFileSync(join(proj, 'src', '__tests__', 'retry.test.ts'), "import { fetchWithBackoff } from '../retry'\nit('x', () => fetchWithBackoff('a'))\n")
    const a = await rt.bash.run('k1', 'cd src && export FOO=bar', { cwd: proj })
    expect(a.ok).toBe(true)
    const b = await rt.bash.run('k1', 'pwd; echo $FOO', { cwd: proj })
    expect((b as { text: string }).text).toMatch(/proj\/src\nbar/)
    expect((await rt.bash.run('bad key!', 'ls', { cwd: proj })).ok).toBe(false)
    const s = await rt.codeIndex.search(proj, ['retry failed requests with backoff'])
    expect(s.ok).toBe(true)
    expect((s as { text: string }).text).toContain('retry.ts')
    const t = await rt.tests.affected(proj, [join(proj, 'src', 'retry.ts')])
    expect(t.ok).toBe(true)
    expect((t as { tests: string[] }).tests).toEqual(['src/__tests__/retry.test.ts'])
    expect((t as { commands: Array<{ command: string }> }).commands[0].command).toContain('vitest run src/__tests__/retry.test.ts')
  }, 30_000)
})
