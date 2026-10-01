import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, statSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => {
  const store = new Map<string, string>()
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => {
        const id = `k${store.size}`
        store.set(id, s)
        return Buffer.from(id, 'utf8')
      },
      decryptString: (buf: Buffer) => {
        const v = store.get(buf.toString('utf8'))
        if (v == null) throw new Error('unknown')
        return v
      }
    }
  }
})

import { TypeSafeClient } from '@typesafe-ai/sdk'
import {
  createDecisionService,
  isLocalBaseUrl,
  normalizeBaseUrl,
  normalizeQuestions,
  type DecisionStore
} from '../decision/service'
import { redactDeep, redactSecrets } from '../decision/redact'
import { createFileDecisionStore } from '../decision/store'
import { emptyDecisionConfig, type DecisionConfig } from '../decision/types'

function memoryStore(initial?: DecisionConfig): DecisionStore & { cfg: DecisionConfig } {
  const s = {
    cfg: initial ?? emptyDecisionConfig(),
    load: () => JSON.parse(JSON.stringify(s.cfg)) as DecisionConfig,
    save: (c: DecisionConfig) => {
      s.cfg = JSON.parse(JSON.stringify(c)) as DecisionConfig
    }
  }
  return s
}

type Call = { url: string; init: RequestInit & { headers: Record<string, string> }; body: any }

/** Real TypeSafe SDK over a scripted fetch. */
function sdkService(reply: (call: Call) => Response | Promise<Response>, store = memoryStore()) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      init: init as Call['init'],
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    }
    calls.push(call)
    return reply(call)
  })
  const svc = createDecisionService({
    store,
    createClient: (cfg) => new TypeSafeClient({ ...cfg, fetch }) as never
  })
  return { svc, calls, store, fetch }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('decision URL helpers', () => {
  it('normalizes API roots and strips /v1', () => {
    expect(normalizeBaseUrl('https://api.typesafe.ai/')).toEqual({ ok: true, url: 'https://api.typesafe.ai' })
    expect(normalizeBaseUrl('http://localhost:11435/v1')).toEqual({ ok: true, url: 'http://localhost:11435' })
    expect(normalizeBaseUrl('https://x.example.com/proxy/v1/?a=1')).toEqual({ ok: true, url: 'https://x.example.com/proxy' })
  })

  it('refuses plain http to remote hosts and credentials in URLs', () => {
    expect(normalizeBaseUrl('http://api.example.com').ok).toBe(false)
    expect(normalizeBaseUrl('https://user:pw@api.example.com').ok).toBe(false)
    expect(normalizeBaseUrl('ftp://localhost').ok).toBe(false)
    expect(normalizeBaseUrl('').ok).toBe(false)
    expect(normalizeBaseUrl('http://192.168.1.20:11435').ok).toBe(true)
  })

  it('detects local hosts', () => {
    for (const u of ['http://localhost:11435', 'http://127.0.0.1:1', 'http://[::1]:11435', 'http://10.0.0.2', 'http://box.local']) {
      expect(isLocalBaseUrl(u), u).toBe(true)
    }
    for (const u of ['https://api.typesafe.ai', 'http://8.8.8.8', 'https://172.32.0.1']) {
      expect(isLocalBaseUrl(u), u).toBe(false)
    }
  })
})

describe('normalizeQuestions', () => {
  it('accepts the three primitives and choice labels as an array', () => {
    const r = normalizeQuestions({
      urgent: { type: 'noul', instructions: 'Urgent?' },
      team: { type: 'choice', instructions: 'Which team?', criteria: ['billing', 'tech'] },
      mood: { type: 'score', instructions: 'How upset?', criteria: ['calm', 'upset', 'furious'] }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.questions.team).toEqual({ type: 'choice', instructions: 'Which team?', criteria: { billing: null, tech: null } })
    expect(r.questions.mood).toMatchObject({ type: 'score', criteria: ['calm', 'upset', 'furious'] })
  })

  it('rejects malformed questions before any network call', () => {
    expect(normalizeQuestions({}).ok).toBe(false)
    expect(normalizeQuestions({ q: { type: 'choice', criteria: ['only'] } }).ok).toBe(false)
    expect(normalizeQuestions({ q: { type: 'score', criteria: ['one'] } }).ok).toBe(false)
    expect(normalizeQuestions({ q: { type: 'essay' } }).ok).toBe(false)
    expect(normalizeQuestions({ 'bad id!': { type: 'noul' } }).ok).toBe(false)
  })
})

describe('redactSecrets', () => {
  it('scrubs keys, tokens and passwords but keeps the command shape', () => {
    const cmd =
      'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://u:p4ss@h.io --password hunter22 && export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv'
    const out = redactSecrets(cmd)
    expect(out).not.toMatch(/abcdefghijklmnop1234|p4ss|hunter22|sk-abcdefghijkl/)
    expect(out).toContain('curl -H')
    expect(out).toContain('OPENAI_API_KEY=[REDACTED]')
    expect(redactSecrets('ghp_0123456789abcdefghij and AKIAABCDEFGHIJKLMNOP')).toBe('[REDACTED] and [REDACTED]')
    expect(redactSecrets('rm -rf ./build')).toBe('rm -rf ./build')
  })

  it('redacts nested JSON values', () => {
    expect(redactDeep({ a: ['token=abcd1234efgh'], n: 3 })).toEqual({ a: ['token=[REDACTED]'], n: 3 })
  })
})

describe('decision service registry', () => {
  it('requires a key for hosted TypeSafe, activates the first provider, and never exposes keys', () => {
    const { svc } = sdkService(() => json(200, {}))
    expect(svc.saveProvider({ kind: 'typesafe' })).toMatchObject({ ok: false })
    const a = svc.saveProvider({ kind: 'typesafe', apiKey: 'ts-live-secret-123456' })
    expect(a.ok).toBe(true)
    const b = svc.saveProvider({ kind: 'ollaya' })
    expect(b.ok).toBe(true)
    const st = svc.status()
    expect(st.providers).toHaveLength(2)
    expect(st.active?.kind).toBe('typesafe')
    expect(st.providers.find((p) => p.kind === 'ollaya')).toMatchObject({ enabled: false, local: true, hasKey: false, model: 'laya' })
    expect(JSON.stringify(st)).not.toContain('ts-live-secret-123456')
    // keyHint intentionally reveals no characters of the key.
    expect(st.providers[0].keyHint).toBe('••••')
    expect(st.providers[0].keyHint).not.toContain('3456')
  })

  it('keeps one provider active, keeps the key on edit, clears it on request', () => {
    const { svc, store } = sdkService(() => json(200, {}))
    const ts = svc.saveProvider({ kind: 'typesafe', apiKey: 'ts-key-abcdefgh' })
    const ol = svc.saveProvider({ kind: 'ollaya', model: 'winnow:e4b' })
    if (!ts.ok || !ol.ok) throw new Error('setup')
    svc.setEnabled(ol.id, true)
    expect(svc.status().active?.id).toBe(ol.id)
    expect(svc.status().providers.filter((p) => p.enabled)).toHaveLength(1)
    svc.saveProvider({ id: ts.id, model: 'jev-1.13.0' })
    expect(store.cfg.providers.find((p) => p.id === ts.id)?.apiKey).toBe('ts-key-abcdefgh')
    // TypeSafe on a remote host can't drop its key.
    expect(svc.saveProvider({ id: ts.id, apiKey: '' }).ok).toBe(false)
    svc.setEnabled(ol.id, false)
    expect(svc.status().active).toBeNull()
    expect(svc.removeProvider(ol.id).ok).toBe(true)
    expect(svc.status().providers).toHaveLength(1)
  })

  it('rejects bad model names and remote http', () => {
    const { svc } = sdkService(() => json(200, {}))
    expect(svc.saveProvider({ kind: 'ollaya', model: 'rm -rf' }).ok).toBe(false)
    expect(svc.saveProvider({ kind: 'custom', baseUrl: 'http://decide.example.com', model: 'x' }).ok).toBe(false)
  })
})

describe('decision calls through the TypeSafe SDK', () => {
  it('posts to /v1/systemone with the key, model and redacted state, and normalizes answers', async () => {
    const { svc, calls } = sdkService(() =>
      json(200, {
        model: 'jev-1.13.0',
        answers: {
          risk: { type: 'choice', choice: 'destructive', confidence: 0.9, probabilities: { read_only: 0.02, destructive: 0.98 } },
          sends: { type: 'noul', noul: 0.03 }
        },
        usage: { input_tokens: 42, output_tokens: 0 }
      })
    )
    svc.saveProvider({ kind: 'typesafe', apiKey: 'ts-key-abcdefgh' })
    const r = await svc.decide(
      {
        state: { command: 'rm -rf / && echo sk-abcdefghijklmnopqrstuv' },
        questions: {
          risk: { type: 'choice', instructions: 'Risk?', criteria: ['read_only', 'destructive'] },
          sends: { type: 'noul', instructions: 'Sends data?' }
        }
      },
      { purpose: 'tool' }
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model).toBe('jev-1.13.0')
    expect(r.answers.risk).toMatchObject({ type: 'choice', choice: 'destructive' })
    expect(r.provider).toMatchObject({ kind: 'typesafe', local: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer ts-key-abcdefgh')
    expect(calls[0].body.model).toBe('jev-latest')
    expect(calls[0].body.state.command).toContain('[REDACTED]')
    expect(calls[0].body.state.command).not.toContain('sk-abcdefghijkl')
    expect(calls[0].body.questions.risk.criteria).toEqual({ read_only: null, destructive: null })
  })

  it('talks to Ollaya on localhost without a real key and explains missing models', async () => {
    const { svc, calls } = sdkService(() =>
      json(404, { error: 'model "laya:latest" not found, try pulling it first', code: 'MODEL_NOT_FOUND' })
    )
    const saved = svc.saveProvider({ kind: 'ollaya' })
    if (!saved.ok) throw new Error('setup')
    const r = await svc.test(saved.id)
    expect(calls[0].url).toBe('http://localhost:11435/v1/systemone')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer local')
    expect(calls[0].body.model).toBe('laya')
    expect(r).toMatchObject({ ok: false, code: 'MODEL_NOT_FOUND', status: 404 })
    if (!r.ok) expect(r.error).toContain('ollaya pull laya')
  })

  it('reports a clear hint when the local server is down', async () => {
    const { svc } = sdkService(() => {
      throw new TypeError('fetch failed')
    })
    const saved = svc.saveProvider({ kind: 'ollaya' })
    if (!saved.ok) throw new Error('setup')
    const r = await svc.test(saved.id)
    expect(r).toMatchObject({ ok: false, code: 'connection' })
    if (!r.ok) expect(r.error).toContain('ollaya serve')
  })

  it('maps 401 to an API-key message', async () => {
    const { svc } = sdkService(() => json(401, { detail: 'bad key' }))
    svc.saveProvider({ kind: 'typesafe', apiKey: 'ts-key-abcdefgh' })
    const r = await svc.decide({ state: 'x', questions: { q: { type: 'noul' } } })
    expect(r).toMatchObject({ ok: false, status: 401 })
    if (!r.ok) expect(r.error).toMatch(/API key/)
  })

  it('reads TypeSafe error bodies ({detail: {error_type, message}}) and FastAPI 422 lists', async () => {
    // Shapes captured from api.typesafe.ai on 2026-09-27.
    const bodies: Array<[number, unknown]> = [
      [403, { detail: { error_type: 'authentication_error', message: 'Must supply an API key! Check your request and try again.' } }],
      [422, { detail: [{ loc: ['body', 'questions', 'q', 'criteria'], msg: 'Field required', type: 'missing' }] }]
    ]
    let i = 0
    const { svc } = sdkService(() => json(bodies[i][0], bodies[i++][1]))
    svc.saveProvider({ kind: 'typesafe', apiKey: 'ts-key-abcdefgh' })
    const q = { state: 'x', questions: { q: { type: 'noul' } } }
    expect(await svc.decide(q)).toMatchObject({ ok: false, status: 403, code: 'authentication_error', error: 'Invalid or missing API key for TypeSafe' })
    expect(await svc.decide(q)).toMatchObject({ ok: false, status: 422, error: 'questions.q.criteria: Field required' })
  })

  it('lists models with release dates', async () => {
    const { svc, calls } = sdkService(() =>
      json(200, { models: [{ name: 'laya:en', description: 'English', release_date: '2026-09-23' }] })
    )
    const saved = svc.saveProvider({ kind: 'ollaya' })
    if (!saved.ok) throw new Error('setup')
    const r = await svc.listModels(saved.id)
    expect(calls[0].url).toBe('http://localhost:11435/v1/models')
    expect(r).toEqual({ ok: true, models: [{ name: 'laya:en', description: 'English', releaseDate: '2026-09-23' }] })
  })

  it('gates each harness purpose on its feature switch and refuses when nothing is active', async () => {
    const { svc, fetch } = sdkService(() => json(200, { model: 'm', answers: {} }))
    const q = { state: 'x', questions: { q: { type: 'noul' } } }
    expect(await svc.decide(q)).toMatchObject({ ok: false, code: 'not_configured' })
    svc.saveProvider({ kind: 'ollaya' })
    expect(await svc.decide(q, { purpose: 'routing' })).toMatchObject({ ok: false, code: 'disabled' })
    svc.setFeatures({ shellRiskGuard: false })
    expect(await svc.decide(q, { purpose: 'shell_risk' })).toMatchObject({ ok: false, code: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
    expect((await svc.decide(q, { purpose: 'tool' })).ok).toBe(true)
  })

  it('refuses oversized payloads locally', async () => {
    const { svc, fetch } = sdkService(() => json(200, {}))
    svc.saveProvider({ kind: 'ollaya' })
    const r = await svc.decide({ state: 'x'.repeat(250_000), questions: { q: { type: 'noul' } } })
    expect(r).toMatchObject({ ok: false, code: 'too_large' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('file decision store', () => {
  let dir = ''
  beforeEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'pawn-decision-'))
  })

  it('seals API keys at rest with 0600 permissions', () => {
    const store = createFileDecisionStore(dir)
    const svc = createDecisionService({ store })
    svc.saveProvider({ kind: 'typesafe', apiKey: 'ts-plain-secret-99' })
    const file = join(dir, 'decision.json')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('ts-plain-secret-99')
    expect(raw).toContain('enc:v1:')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(store.load().providers[0].apiKey).toBe('ts-plain-secret-99')
    rmSync(dir, { recursive: true, force: true })
    dir = ''
  })
})

describe('end to end over real HTTP (TypeSafe-compatible local server)', () => {
  it('lists models, tests, and decides against a loopback server with the default SDK transport', async () => {
    const { createServer } = await import('http')
    const seen: Array<{ method: string; url: string; auth?: string; body?: any }> = []
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        seen.push({ method: req.method || '', url: req.url || '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined })
        res.setHeader('content-type', 'application/json')
        res.setHeader('x-typesafe-request-id', 'req-1')
        if (req.url === '/v1/models') {
          res.end(JSON.stringify({ models: [{ name: 'laya:en', description: 'English', release_date: '2026-09-23' }] }))
          return
        }
        if (req.url === '/v1/systemone') {
          const body = JSON.parse(raw)
          const answers: Record<string, unknown> = {}
          for (const [id, q] of Object.entries<any>(body.questions)) {
            if (q.type === 'noul') answers[id] = { type: 'noul', noul: 0.91 }
            else if (q.type === 'choice') {
              const labels = Object.keys(q.criteria)
              answers[id] = { type: 'choice', choice: labels[0], confidence: 0.7, probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.8 : 0.2 / (labels.length - 1)])) }
            }
          }
          res.end(JSON.stringify({ model: 'laya:en', answers, usage: { input_tokens: 40, output_tokens: 0 } }))
          return
        }
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'not found', code: 'NOT_FOUND' }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    try {
      const svc = createDecisionService({ store: memoryStore() })
      const saved = svc.saveProvider({ kind: 'ollaya', baseUrl: `http://127.0.0.1:${port}/v1` })
      if (!saved.ok) throw new Error(saved.error)
      expect(svc.status().active).toMatchObject({ baseUrl: `http://127.0.0.1:${port}`, local: true })
      expect(await svc.listModels(saved.id)).toMatchObject({ ok: true, models: [{ name: 'laya:en' }] })
      const t = await svc.test(saved.id)
      expect(t).toMatchObject({ ok: true, model: 'laya:en', provider: { local: true } })
      const r = await svc.decide({
        state: { ticket: 'I was charged twice' },
        questions: { team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Payments', technical: null } } }
      })
      expect(r).toMatchObject({ ok: true, answers: { team: { type: 'choice', choice: 'billing' } } })
      const posts = seen.filter((s) => s.url === '/v1/systemone')
      expect(posts).toHaveLength(2)
      expect(posts[1].auth).toBe('Bearer local')
      expect(posts[1].body).toMatchObject({ model: 'laya', state: { ticket: 'I was charged twice' } })
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})
