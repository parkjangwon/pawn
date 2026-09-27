/**
 * End-to-end: the agent's "physical" capabilities through the real agent loop
 * (router → streaming LLM call → tool dispatch → handlers → Node runtime →
 * tool results → next request), with a scripted model behind a local
 * OpenAI- / Anthropic-compatible server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runHeadlessTurn } from '../runner'
import type { HeadlessConfig } from '../nodeApi'

type ToolSpec = { name: string; args: Record<string, unknown>; delayMs?: number }
interface Step {
  tools?: ToolSpec[]
  text?: string
  /** Delay before the final chunk (after the tool calls). */
  tailDelayMs?: number
  /** Delay before responding at all. */
  delayMs?: number
}
interface Req {
  body: any
  /** Tool results the model has seen so far (OpenAI `tool` messages / Claude tool_result text). */
  toolResults: string[]
  /** Everything the model was sent, flattened. */
  text: string
}

let server: Server
let baseUrl = ''
let script: (req: Req) => Step = () => ({ text: 'ok' })
let oneShot: (body: any) => string = () => 'second opinion: check the path'
let requests: Req[] = []
let finalChunkAt: number[] = []

function flatten(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(flatten).join('\n')
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).map(flatten).join('\n')
  return ''
}

function toolResultsOf(body: any): string[] {
  const out: string[] = []
  for (const m of body.messages || []) {
    if (m.role === 'tool') out.push(flatten(m.content))
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content) if (b?.type === 'tool_result') out.push(flatten(b.content))
    }
  }
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}')
      const claude = (req.url || '').endsWith('/messages')
      if (body.stream === false || body.stream === undefined) {
        // Non-streaming one-shot (second opinion / summaries / lessons).
        const text = oneShot(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify(
            claude
              ? { content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } }
              : { choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }
          )
        )
        return
      }
      const r: Req = { body, toolResults: toolResultsOf(body), text: flatten(body.messages) + flatten(body.system) }
      requests.push(r)
      const step = script(r)
      if (step.delayMs) await sleep(step.delayMs)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`)
      const n = requests.length
      if (claude) {
        send({ type: 'message_start', message: { usage: { input_tokens: 500, output_tokens: 1 } } })
        let idx = 0
        if (step.text) {
          send({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } })
          send({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: step.text } })
          send({ type: 'content_block_stop', index: idx++ })
        }
        for (const [i, t] of (step.tools || []).entries()) {
          if (t.delayMs) await sleep(t.delayMs)
          send({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: `toolu_${n}_${i}`, name: t.name } })
          send({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.args) } })
          send({ type: 'content_block_stop', index: idx++ })
        }
        if (step.tailDelayMs) await sleep(step.tailDelayMs)
        finalChunkAt.push(Date.now())
        send({ type: 'message_delta', delta: { stop_reason: step.tools?.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } })
        send({ type: 'message_stop' })
        res.end()
        return
      }
      if (step.text) send({ choices: [{ index: 0, delta: { content: step.text } }] })
      for (const [i, t] of (step.tools || []).entries()) {
        if (t.delayMs) await sleep(t.delayMs)
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${n}_${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }] } }] })
      }
      if (step.tailDelayMs) await sleep(step.tailDelayMs)
      finalChunkAt.push(Date.now())
      send({ choices: [{ index: 0, delta: {}, finish_reason: step.tools?.length ? 'tool_calls' : 'stop' }] })
      send({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 20 } })
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

let dir = ''
beforeEach(async () => {
  requests = []
  finalChunkAt = []
  oneShot = () => 'second opinion: check the path'
  dir = await mkdtemp(join(tmpdir(), 'pawn-phys-'))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

function config(opts: { modelId?: string; format?: 'openai' | 'claude'; contextWindow?: number; second?: boolean; base?: string } = {}): HeadlessConfig {
  const model = (id: string, modelId: string, tier: string) => ({
    id,
    providerId: 'fake',
    modelId,
    label: modelId,
    tier,
    enabled: true,
    supportsTools: true,
    supportsVision: false,
    contextWindow: opts.contextWindow ?? 128_000,
    pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 }
  })
  return {
    settings: { routingMode: 'manual', activeModelId: 'fake:main', doneGate: 'off', smartCompaction: false },
    providers: [{ id: 'fake', name: 'Fake', apiFormat: opts.format ?? 'openai', baseUrl: opts.base ?? baseUrl, apiKey: 'k', enabled: true }],
    models: [model('fake:main', opts.modelId ?? 'fake-model', 'mid'), ...(opts.second ? [model('fake:other', 'other-model', 'high')] : [])]
  }
}

const turn = (prompt: string, cfg: HeadlessConfig, extra: Record<string, unknown> = {}) =>
  runHeadlessTurn({ prompt, cwd: dir, config: cfg, permission: 'yolo', timeoutMs: 90_000, modelId: 'fake:main', ...extra })

const toolNames = (body: any): string[] => (body.tools || []).map((t: any) => t.function?.name ?? t.name ?? t.type)

describe('model-native coding tools', () => {
  it('GPT: apply_patch replaces edit_file/write_file and lands a multi-file change', async () => {
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'cart.ts'), 'export function total(xs: number[]) {\n  let t = 0\n  for (const x of xs) t += x\n  return t\n}\n')
    script = ({ toolResults }) =>
      toolResults.length === 0
        ? {
            tools: [
              {
                name: 'apply_patch',
                args: {
                  input: [
                    '*** Begin Patch',
                    '*** Update File: src/cart.ts',
                    '@@ export function total(xs: number[]) {',
                    '-  let t = 0',
                    '-  for (const x of xs) t += x',
                    '-  return t',
                    '+  return xs.reduce((a, b) => a + b, 0)',
                    '*** Add File: src/cart.test.ts',
                    "+import { total } from './cart'",
                    "+test('total', () => expect(total([1, 2])).toBe(3))",
                    '*** End Patch'
                  ].join('\n')
                }
              }
            ]
          }
        : { text: `done: ${toolResults[0].split('\n')[0]}` }
    const res = await turn('refactor total to use reduce and add a test', config({ modelId: 'gpt-5.4' }))
    const names = toolNames(requests[0].body)
    expect(names).toContain('apply_patch')
    expect(names).not.toContain('edit_file')
    expect(names).not.toContain('write_file')
    expect(requests[0].text).toContain('apply_patch replaces edit_file / write_file here')
    expect(res.finalText).toBe('done: Success. Updated the following files:')
    expect(await readFile(join(dir, 'src', 'cart.ts'), 'utf8')).toBe('export function total(xs: number[]) {\n  return xs.reduce((a, b) => a + b, 0)\n}\n')
    expect(await readFile(join(dir, 'src', 'cart.test.ts'), 'utf8')).toContain("import { total } from './cart'")
    expect(res.tools.map((t) => `${t.name}:${t.status}`)).toEqual(['apply_patch:ok'])
  }, 60_000)

  it('Claude on the Anthropic API: text editor + persistent bash (state survives between calls)', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'greet.py'), 'def greet(name):\n    return "hi " + name\n')
    // Route the official Anthropic host to the local fake server.
    const real = globalThis.fetch
    vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) =>
      real(String(url).replace('https://api.anthropic.com/v1', baseUrl), init)
    )
    script = ({ toolResults }) => {
      switch (toolResults.length) {
        case 0:
          return { tools: [{ name: 'str_replace_based_edit_tool', args: { command: 'view', path: 'greet.py' } }] }
        case 1:
          return {
            tools: [
              { name: 'str_replace_based_edit_tool', args: { command: 'str_replace', path: 'greet.py', old_str: 'return "hi " + name', new_str: 'return f"hello {name}"' } },
              { name: 'bash', args: { command: 'cd sub && export PAWN_E2E=42 && greet() { echo "fn:$1"; }' } }
            ]
          }
        case 3:
          return { tools: [{ name: 'bash', args: { command: 'pwd; echo "var=$PAWN_E2E"; greet ok' } }] }
        default:
          return { text: 'finished' }
      }
    }
    const res = await turn('Use greet.py: make greet say hello', config({ modelId: 'claude-opus-5-5', format: 'claude', base: 'https://api.anthropic.com/v1' }))
    const types = (requests[0].body.tools as any[]).map((t) => t.type || t.name)
    expect(types).toContain('text_editor_20250728')
    expect(types).toContain('bash_20250124')
    expect(types).not.toContain('edit_file')
    expect(requests[0].body.tools.filter((t: any) => t.cache_control)).toHaveLength(1)
    expect(requests[1].toolResults[0]).toContain('     1\tdef greet(name):')
    expect(await readFile(join(dir, 'greet.py'), 'utf8')).toContain('return f"hello {name}"')
    const last = requests[3].toolResults[3]
    expect(last).toContain(`${join(dir, 'sub')}`)
    expect(last).toContain('var=42')
    expect(last).toContain('fn:ok')
    expect(res.finalText).toBe('finished')
  }, 60_000)
})

describe('speed: streaming tool execution + mentioned-file prefetch', () => {
  it('starts read-only tools while the response is still streaming', async () => {
    await writeFile(join(dir, 'a.txt'), 'alpha\n')
    await writeFile(join(dir, 'b.txt'), 'beta\n')
    let readAt = 0
    script = (r) => {
      if (r.toolResults.length === 0) {
        // Observe the first read from inside the runtime.
        const api = (globalThis as any).window.api
        const orig = api.fs.readFile
        api.fs.readFile = async (p: string) => {
          if (p.endsWith('a.txt') && !readAt) readAt = Date.now()
          return orig(p)
        }
        return {
          tools: [
            { name: 'read_file', args: { path: 'a.txt' } },
            { name: 'read_file', args: { path: 'b.txt' }, delayMs: 600 }
          ],
          tailDelayMs: 600
        }
      }
      return { text: r.toolResults.join(' | ') }
    }
    const res = await turn('read the two files', config())
    expect(res.finalText).toBe('alpha\n | beta\n')
    expect(readAt).toBeGreaterThan(0)
    // a.txt was read ≥1s before the model finished responding.
    expect(finalChunkAt[0] - readAt).toBeGreaterThan(900)
  }, 60_000)

  it('attaches files named in the message before the first model call', async () => {
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'app.ts'), 'export const answer = 42\n')
    script = () => ({ text: 'ok' })
    await turn('What does `src/app.ts` export?', config())
    expect(requests[0].text).toContain('<mentioned_files>')
    expect(requests[0].text).toContain('<file path="src/app.ts" lines="1-2">\n     1\texport const answer = 42')
  }, 30_000)
})

describe('runtime perception', () => {
  it('waits for a dev server, then surfaces errors it prints later without being asked', async () => {
    await writeFile(
      join(dir, 'server.js'),
      "const http = require('http')\nconst s = http.createServer((q, r) => r.end('ok'))\ns.listen(0, '127.0.0.1', () => {\n  console.log('listening on http://127.0.0.1:' + s.address().port)\n  setTimeout(() => console.error('Error: database connection refused (ECONNREFUSED)'), 700)\n  setTimeout(() => process.exit(0), 6000)\n})\n"
    )
    let jobId = ''
    script = (r) => {
      const n = r.toolResults.length
      if (n === 0) return { tools: [{ name: 'shell_exec', args: { command: 'node server.js', background: true } }] }
      if (n === 1) {
        jobId = /Background job started: (\S+)/.exec(r.toolResults[0])?.[1] || ''
        return { tools: [{ name: 'shell_wait', args: { job_id: jobId, until: 'listening on', timeout: 20 } }] }
      }
      if (n === 2) return { tools: [{ name: 'list_dir', args: { path: '.' } }], delayMs: 1500 }
      if (n === 3) return { tools: [{ name: 'shell_kill', args: { job_id: jobId } }] }
      return { text: 'done' }
    }
    await turn('start the server and check it', config())
    const waited = requests[2].toolResults[1]
    expect(waited).toMatch(/matched: listening on http:\/\/127\.0\.0\.1:\d+/)
    expect(waited).toMatch(/\[detected\] urls: http:\/\/127\.0\.0\.1:\d+/)
    const later = requests[3].toolResults[2]
    expect(later).toContain('<runtime_events>')
    expect(later).toContain('Error: database connection refused (ECONNREFUSED)')
  }, 60_000)
})

describe('context endurance', () => {
  it('offloads a huge output and lets the agent grep it back with read_output', async () => {
    script = (r) => {
      const n = r.toolResults.length
      if (n === 0) return { tools: [{ name: 'shell_exec', args: { command: `node -e "for (let i = 1; i <= 40000; i++) console.log(i === 31337 ? 'NEEDLE found at line ' + i : 'filler line ' + i)"` } }] }
      if (n === 1) {
        const id = /read_output \{"id":"(out_[0-9a-f]{8})"\}/.exec(r.toolResults[0])?.[1]
        return { tools: [{ name: 'read_output', args: { id, grep: 'NEEDLE' } }] }
      }
      return { text: r.toolResults[1] }
    }
    const res = await turn('run the generator', config())
    expect(requests[1].toolResults[0]).toContain('truncated')
    expect(requests[1].toolResults[0]).toMatch(/\[full output: [\d,]+ chars saved — read_output/)
    expect(res.finalText).toContain('NEEDLE found at line 31337')
    expect(res.finalText).toContain('1 matching line')
  }, 60_000)

  it('clears stale bulky tool results before the context fills up', async () => {
    for (let i = 0; i < 6; i++) await writeFile(join(dir, `big${i}.txt`), `file ${i}\n` + 'lorem ipsum dolor sit amet '.repeat(1100))
    script = (r) => {
      const n = r.toolResults.length
      if (n < 6) return { tools: [{ name: 'read_file', args: { path: `big${n}.txt` } }] }
      return { text: 'read all' }
    }
    await turn('read big0..big5', config({ contextWindow: 40_000 }))
    const last = requests[requests.length - 1]
    expect(last.toolResults.some((t) => t.startsWith('[cleared to save context: read_file big0.txt'))).toBe(true)
    expect(last.toolResults.some((t) => /read_output \{"id":"out_[0-9a-f]{8}"\}/.test(t))).toBe(true)
    // The most recent results are intact.
    expect(last.toolResults[last.toolResults.length - 1]).toContain('file 5')
  }, 60_000)
})

describe('stuck recovery', () => {
  it('climbs the ladder (reflect → escalate → second opinion → …) and hands back to the user', async () => {
    let n = 0
    script = () => {
      n++
      return { tools: [{ name: 'read_file', args: { path: 'does/not/exist.ts' } }] }
    }
    oneShot = () => 'Root cause: that path does not exist — list the directory first instead of re-reading it.'
    const res = await turn('fix the bug in the parser', config({ second: true }))
    const all = requests.map((r) => r.toolResults.join('\n')).join('\n')
    expect(all).toContain('<stuck_recovery level="1"')
    expect(all).toContain('<stuck_recovery level="2"')
    expect(all).toContain('<second_opinion model="other-model">')
    expect(all).toContain('Root cause: that path does not exist')
    expect(res.finalText).toContain('kept getting stuck')
    // Stopped by the ladder long before the round ceiling.
    expect(n).toBeLessThan(15)
  }, 90_000)
})

describe('debugger through the agent loop', () => {
  it('stops at a breakpoint, inspects locals, evaluates, and runs to completion', async () => {
    await writeFile(join(dir, 'calc.js'), 'function avg(xs) {\n  let sum = 0\n  for (const x of xs) sum += x\n  const mean = sum / xs.length\n  return mean\n}\nconsole.log("avg=" + avg([2, 4, 9]))\n')
    script = (r) => {
      const n = r.toolResults.length
      if (n === 0) return { tools: [{ name: 'debug_start', args: { program: 'calc.js', breakpoints: [{ path: 'calc.js', line: 5 }] } }] }
      if (n === 1) return { tools: [{ name: 'debug_eval', args: { expression: 'sum * 2' } }] }
      if (n === 2) return { tools: [{ name: 'debug_breakpoints', args: { path: 'calc.js', lines: [] } }, { name: 'debug_control', args: { action: 'continue' } }] }
      return { text: 'debugged' }
    }
    const res = await turn('debug calc.js: why is the average wrong? use the debugger', config())
    const started = requests[1].toolResults[0]
    expect(started).toContain('stopped (breakpoint)')
    expect(started).toMatch(/sum = 15/)
    expect(started).toMatch(/mean = 5/)
    expect(requests[2].toolResults[1]).toBe('sum * 2 = 30  (number)')
    const ended = requests[3].toolResults[3]
    expect(ended).toContain('terminated')
    expect(ended).toContain('avg=5')
    expect(res.finalText).toBe('debugged')
  }, 90_000)
})

describe('code intelligence + repo profile', () => {
  it('semantic search, affected tests, and a learned repo profile', async () => {
    await mkdir(join(dir, 'src', 'net'), { recursive: true })
    await mkdir(join(dir, 'src', '__tests__'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node -e "process.exit(0)"' }, devDependencies: { vitest: '1' } }))
    await writeFile(join(dir, 'src', 'net', 'backoff.ts'), '/** Retry failed HTTP requests with exponential backoff and jitter. */\nexport async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {\n  let delay = 200\n  for (let i = 0; ; i++) {\n    try { return await fn() } catch (e) { if (i >= attempts) throw e }\n    await new Promise((r) => setTimeout(r, delay))\n    delay *= 2\n  }\n}\n')
    await writeFile(join(dir, 'src', 'net', 'client.ts'), "import { retryWithBackoff } from './backoff'\nexport const get = (u: string) => retryWithBackoff(() => fetch(u))\n")
    await writeFile(join(dir, 'src', '__tests__', 'client.test.ts'), "import { get } from '../net/client'\nit('get', () => expect(get).toBeTypeOf('function'))\n")
    await writeFile(join(dir, 'src', 'ui.ts'), 'export const button = "click"\n')
    script = (r) => {
      const n = r.toolResults.length
      if (n === 0) return { tools: [{ name: 'semantic_search', args: { queries: ['where are failed requests retried', 'exponential backoff retry'] } }, { name: 'affected_tests', args: { paths: ['src/net/backoff.ts'] } }] }
      if (n === 2) return { tools: [{ name: 'shell_exec', args: { command: 'npm run test' } }] }
      return { text: 'ok' }
    }
    await turn('find the retry logic and the tests that cover it', config())
    expect(requests[0].text).toContain('--- Repo profile')
    expect(requests[0].text).toContain('test: `npm run test`')
    const [search, affected] = requests[1].toolResults
    expect(search.split('\n')[0]).toContain('src/net/backoff.ts')
    expect(affected).toContain('src/__tests__/client.test.ts')
    expect(affected).toContain('npx vitest run src/__tests__/client.test.ts')
    const { loadProfile } = await import('../../renderer/src/agent/repoProfile')
    const profile = await loadProfile(dir)
    expect(profile?.commands.test).toMatchObject({ command: 'npm run test', verified: true })
  }, 90_000)
})
