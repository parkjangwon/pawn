import { PassThrough } from 'node:stream'
import { describe, it, expect, vi } from 'vitest'
import { DapClient, type DapMessage } from '../dapClient'
import {
  detectLanguage,
  resolveLanguage,
  buildPythonLaunchArgs,
  buildGoLaunchArgs,
  buildLldbLaunchArgs,
  buildLaunchArgs,
  augmentedPath,
  GO_PORT_REGEX
} from '../adapters'
import { formatDebugState } from '../manager'
import type { DebugState } from '../types'

// --------------------------------------------------------------------------
// Fake adapter: reads Content-Length framed requests from the client's output
// stream and lets the test push framed responses/events back on the input.
// --------------------------------------------------------------------------

function frame(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, body])
}

interface Harness {
  client: DapClient
  toClient: PassThrough // adapter -> client (client's input)
  fromClient: PassThrough // client -> adapter (client's output)
  requests: DapMessage[]
  waitForRequest: (command: string, timeoutMs?: number) => Promise<DapMessage>
}

function makeHarness(): Harness {
  const toClient = new PassThrough()
  const fromClient = new PassThrough()
  const requests: DapMessage[] = []
  const requestWaiters: Array<{ command: string; resolve: (m: DapMessage) => void }> = []

  let buf = Buffer.alloc(0)
  let contentLength = -1
  fromClient.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (contentLength < 0) {
        const idx = buf.indexOf('\r\n\r\n', 0, 'ascii')
        if (idx === -1) return
        const header = buf.toString('ascii', 0, idx)
        const m = /Content-Length:\s*(\d+)/i.exec(header)
        contentLength = m ? parseInt(m[1], 10) : 0
        buf = buf.subarray(idx + 4)
      }
      if (buf.length < contentLength) return
      const body = buf.subarray(0, contentLength)
      buf = buf.subarray(contentLength)
      contentLength = -1
      const msg = JSON.parse(body.toString('utf8')) as DapMessage
      requests.push(msg)
      const wi = requestWaiters.findIndex((w) => w.command === (msg.command as string))
      if (wi >= 0) {
        const [w] = requestWaiters.splice(wi, 1)
        w.resolve(msg)
      }
    }
  })

  const client = new DapClient(toClient, fromClient)

  const waitForRequest = (command: string, timeoutMs = 1000): Promise<DapMessage> => {
    const existing = requests.find((r) => r.command === command)
    if (existing) return Promise.resolve(existing)
    return new Promise<DapMessage>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no request "${command}"`)), timeoutMs)
      requestWaiters.push({
        command,
        resolve: (m) => {
          clearTimeout(t)
          resolve(m)
        }
      })
    })
  }

  return { client, toClient, fromClient, requests, waitForRequest }
}

describe('DapClient framing & correlation', () => {
  it('resolves a request with its response body', async () => {
    const h = makeHarness()
    const p = h.client.request('initialize', { clientID: 'pawn' })
    const req = await h.waitForRequest('initialize')
    expect(req.type).toBe('request')
    expect((req as Record<string, unknown>).arguments).toEqual({ clientID: 'pawn' })
    h.toClient.write(
      frame({
        seq: 1,
        type: 'response',
        request_seq: req.seq,
        success: true,
        command: 'initialize',
        body: { supportsConfigurationDoneRequest: true }
      })
    )
    await expect(p).resolves.toEqual({ supportsConfigurationDoneRequest: true })
    h.client.dispose()
  })

  it('rejects with the adapter error message on success:false', async () => {
    const h = makeHarness()
    const p = h.client.request('launch', {})
    const req = await h.waitForRequest('launch')
    h.toClient.write(
      frame({
        seq: 1,
        type: 'response',
        request_seq: req.seq,
        success: false,
        command: 'launch',
        message: 'could not launch'
      })
    )
    await expect(p).rejects.toThrow('could not launch')
    h.client.dispose()
  })

  it('handles a response split across multiple chunks', async () => {
    const h = makeHarness()
    const p = h.client.request('threads')
    const req = await h.waitForRequest('threads')
    const full = frame({
      seq: 1,
      type: 'response',
      request_seq: req.seq,
      success: true,
      command: 'threads',
      body: { threads: [{ id: 1, name: 'main' }] }
    })
    const mid = Math.floor(full.length / 2)
    h.toClient.write(full.subarray(0, mid))
    await new Promise((r) => setTimeout(r, 5))
    h.toClient.write(full.subarray(mid))
    await expect(p).resolves.toEqual({ threads: [{ id: 1, name: 'main' }] })
    h.client.dispose()
  })

  it('handles multiple messages packed in one chunk', async () => {
    const h = makeHarness()
    const p1 = h.client.request('a')
    const p2 = h.client.request('b')
    const ra = await h.waitForRequest('a')
    const rb = await h.waitForRequest('b')
    const combined = Buffer.concat([
      frame({ seq: 1, type: 'response', request_seq: ra.seq, success: true, command: 'a', body: 1 }),
      frame({ seq: 2, type: 'response', request_seq: rb.seq, success: true, command: 'b', body: 2 })
    ])
    h.toClient.write(combined)
    await expect(p1).resolves.toBe(1)
    await expect(p2).resolves.toBe(2)
    h.client.dispose()
  })

  it('computes byte length correctly for multibyte UTF-8 bodies', async () => {
    const h = makeHarness()
    const p = h.client.request('evaluate', { expression: '"日本語テスト 🚀"' })
    const req = await h.waitForRequest('evaluate')
    expect((req as Record<string, unknown>).arguments).toEqual({
      expression: '"日本語テスト 🚀"'
    })
    h.toClient.write(
      frame({
        seq: 1,
        type: 'response',
        request_seq: req.seq,
        success: true,
        command: 'evaluate',
        body: { result: '日本語テスト 🚀' }
      })
    )
    await expect(p).resolves.toEqual({ result: '日本語テスト 🚀' })
    h.client.dispose()
  })

  it('emits events to listeners', async () => {
    const h = makeHarness()
    const onStopped = vi.fn()
    h.client.on('event:stopped', onStopped)
    h.toClient.write(
      frame({ seq: 1, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } })
    )
    await new Promise((r) => setTimeout(r, 5))
    expect(onStopped).toHaveBeenCalledWith({ reason: 'breakpoint', threadId: 1 })
    h.client.dispose()
  })

  it('answers reverse requests (runInTerminal) with success:false', async () => {
    const h = makeHarness()
    // Adapter sends a reverse request to the client.
    h.toClient.write(
      frame({ seq: 42, type: 'request', command: 'runInTerminal', arguments: { args: ['x'] } })
    )
    // The client should write a response back on its output stream.
    const resp = await h.waitForRequest('runInTerminal')
    expect(resp.type).toBe('response')
    expect(resp.success).toBe(false)
    expect(resp.request_seq).toBe(42)
    h.client.dispose()
  })

  it('rejects pending requests on dispose', async () => {
    const h = makeHarness()
    const p = h.client.request('slow')
    await h.waitForRequest('slow')
    h.client.dispose()
    await expect(p).rejects.toThrow(/disposed/)
  })

  it('times out a request that never gets a response', async () => {
    const h = makeHarness()
    const p = h.client.request('never', {}, 30)
    await expect(p).rejects.toThrow(/timed out/)
    h.client.dispose()
  })
})

describe('adapters: language detection', () => {
  it('detects by extension', () => {
    expect(detectLanguage('/a/b/foo.py')).toBe('python')
    expect(detectLanguage('/a/b/foo.go')).toBe('go')
    expect(detectLanguage('/a/b/foo.js')).toBe('node')
    expect(detectLanguage('/a/b/foo.mjs')).toBe('node')
    expect(detectLanguage('/a/b/foo.cjs')).toBe('node')
    expect(detectLanguage('/a/b/foo.ts')).toBe('node')
  })

  it('falls back to lldb for an extension-less executable', () => {
    expect(detectLanguage('/usr/local/bin/mytool')).toBe('lldb')
  })

  it('honours an explicit language over auto-detect', () => {
    expect(
      resolveLanguage({ sessionKey: 'k', program: '/x/y.py', cwd: '/x', language: 'lldb' })
    ).toBe('lldb')
    expect(
      resolveLanguage({ sessionKey: 'k', program: '/x/y.bin', cwd: '/x', language: 'auto' })
    ).toBe('lldb')
  })
})

describe('adapters: launch-arg builders', () => {
  const base = {
    sessionKey: 'k',
    program: '/proj/main',
    cwd: '/proj',
    args: ['--flag', '1'],
    env: { FOO: 'bar' },
    stopOnEntry: true
  }

  it('python (debugpy) args', () => {
    const a = buildPythonLaunchArgs(base)
    expect(a).toMatchObject({
      type: 'python',
      request: 'launch',
      program: '/proj/main',
      args: ['--flag', '1'],
      cwd: '/proj',
      env: { FOO: 'bar' },
      stopOnEntry: true,
      justMyCode: true,
      console: 'internalConsole'
    })
  })

  it('go (dlv) args', () => {
    const a = buildGoLaunchArgs(base)
    expect(a).toMatchObject({
      mode: 'debug',
      request: 'launch',
      program: '/proj/main',
      stopOnEntry: true
    })
  })

  it('lldb-dap args with env as K=V array', () => {
    const a = buildLldbLaunchArgs(base)
    expect(a.program).toBe('/proj/main')
    expect(a.env).toEqual(['FOO=bar'])
    expect(a.stopOnEntry).toBe(true)
  })

  it('buildLaunchArgs dispatches by language', () => {
    expect((buildLaunchArgs('python', base) as Record<string, unknown>).type).toBe('python')
    expect((buildLaunchArgs('go', base) as Record<string, unknown>).mode).toBe('debug')
    expect((buildLaunchArgs('lldb', base) as Record<string, unknown>).program).toBe('/proj/main')
  })

  it('augmentedPath adds common toolchain dirs', () => {
    const p = augmentedPath({ PATH: '/usr/bin' })
    expect(p).toContain('/usr/bin')
    expect(p).toContain('/opt/homebrew/bin')
    expect(p).toContain('/usr/local/bin')
  })

  it('GO_PORT_REGEX parses the delve announcement', () => {
    const m = GO_PORT_REGEX.exec('DAP server listening at: 127.0.0.1:54321')
    expect(m?.[1]).toBe('54321')
  })
})

describe('formatDebugState', () => {
  it('renders a stopped state with source, locals, stack, output, breakpoints', () => {
    const state: DebugState = {
      sessionKey: 'demo',
      language: 'node',
      status: 'stopped',
      reason: 'breakpoint',
      threadId: 1,
      location: { path: '/proj/app.js', line: 10, column: 3, function: 'compute' },
      source: '  9 | const a = 1\n→ 10 | const b = 2\n 11 | return a + b',
      locals: [
        { name: 'a', value: '1', type: 'number' },
        { name: 'b', value: '2', type: 'number' }
      ],
      stack: [
        { id: 0, name: 'compute', path: '/proj/app.js', line: 10 },
        { id: 1, name: 'main', path: '/proj/app.js', line: 20 }
      ],
      output: 'hello\n',
      breakpoints: [{ path: '/proj/app.js', line: 10, verified: true }]
    }
    const text = formatDebugState(state)
    expect(text).toContain('stopped')
    expect(text).toContain('breakpoint')
    expect(text).toContain('/proj/app.js:10')
    expect(text).toContain('compute')
    expect(text).toContain('→ 10 |')
    expect(text).toContain('a = 1')
    expect(text).toContain('#0 compute')
    expect(text).toContain('hello')
    expect(text).toContain('Breakpoints:')
  })

  it('renders a terminated state with exit code', () => {
    const state: DebugState = {
      sessionKey: 'demo',
      language: 'node',
      status: 'terminated',
      exitCode: 0,
      output: 'done\n'
    }
    const text = formatDebugState(state)
    expect(text).toContain('terminated')
    expect(text).toContain('exit code 0')
    expect(text).toContain('done')
  })

  it('marks unverified breakpoints', () => {
    const state: DebugState = {
      sessionKey: 'demo',
      language: 'python',
      status: 'running',
      output: '',
      breakpoints: [{ path: '/x.py', line: 3, verified: false }]
    }
    const text = formatDebugState(state)
    expect(text).toContain('(unverified)')
  })
})
