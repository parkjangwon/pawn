import { describe, it, expect, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { EventStreamDecoder, encodeEventStreamMessage, crc32 } from '../eventStream'
import { KiroAuth, KiroAuthError, parseImportedToken, readKiroCliLogin, type KiroCredentials } from '../auth'
import { chatEndpoints, KiroClient, kiroHeaders, type KiroEvent } from '../client'
import { createKiroService, type KiroStreamEvent } from '../service'

const enc = (type: string, payload: unknown, messageType = 'event'): Uint8Array =>
  encodeEventStreamMessage(
    messageType === 'exception'
      ? { ':message-type': 'exception', ':exception-type': type, ':content-type': 'application/json' }
      : { ':message-type': messageType, ':event-type': type, ':content-type': 'application/json' },
    JSON.stringify(payload)
  )

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Response whose body streams `bytes` in chunks of `chunk`. */
function streamResponse(bytes: Uint8Array, chunk = 7, status = 200): Response {
  let i = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (i >= bytes.length) return c.close()
        c.enqueue(bytes.slice(i, i + chunk))
        i += chunk
      }
    }),
    { status, headers: { 'content-type': 'application/vnd.amazon.eventstream' } }
  )
}

const memStore = (initial: KiroCredentials | null = null) => {
  let v = initial
  const saves: Array<KiroCredentials | null> = []
  return {
    store: {
      load: async () => v,
      save: async (c: KiroCredentials | null) => {
        v = c
        saves.push(c)
      }
    },
    get: () => v,
    saves
  }
}

describe('AWS event-stream decoder', () => {
  it('decodes messages split at every byte boundary, with headers and CRCs', () => {
    const a = enc('assistantResponseEvent', { content: 'héllo' })
    const b = enc('toolUseEvent', { toolUseId: 't1', name: 'x', input: '{"a":' })
    const all = concat([a, b])
    const d = new EventStreamDecoder()
    const got: Array<{ type: unknown; body: string }> = []
    for (let i = 0; i < all.length; i++) {
      for (const m of d.push(all.slice(i, i + 1))) got.push({ type: m.headers[':event-type'], body: new TextDecoder().decode(m.payload) })
    }
    expect(got).toEqual([
      { type: 'assistantResponseEvent', body: '{"content":"héllo"}' },
      { type: 'toolUseEvent', body: '{"toolUseId":"t1","name":"x","input":"{\\"a\\":"}' }
    ])
    expect(d.pending).toBe(0)
  })

  it('rejects corrupted frames', () => {
    const a = enc('assistantResponseEvent', { content: 'x' })
    a[a.length - 6] ^= 0xff
    expect(() => new EventStreamDecoder().push(a)).toThrow(/CRC/)
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('Kiro auth', () => {
  it('runs the Builder ID device flow with its own client registration, and refreshes', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let polls = 0
    let now = 1_000_000
    const fetchFn = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push({ url, body })
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
      if (url.endsWith('/client/register')) return json({ clientId: 'cid', clientSecret: 'secret', clientSecretExpiresAt: 2_000_000_000 })
      if (url.endsWith('/device_authorization')) return json({ deviceCode: 'dc', userCode: 'ABCD-EFGH', verificationUri: 'https://device.sso', verificationUriComplete: 'https://device.sso?code=ABCD', interval: 1, expiresIn: 600 })
      if (url.endsWith('/token') && body.grantType !== 'refresh_token') {
        polls++
        if (polls === 1) return json({ error: 'authorization_pending' }, 400)
        if (polls === 2) return json({ error: 'slow_down' }, 400)
        return json({ accessToken: 'at1', refreshToken: 'rt1', expiresIn: 3600 })
      }
      if (url.endsWith('/token')) return json({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 3600 })
      return json({}, 404)
    }) as unknown as typeof fetch
    const m = memStore()
    const sleeps: number[] = []
    const auth = new KiroAuth(m.store, { fetch: fetchFn, now: () => now, sleep: async (ms) => void sleeps.push(ms) })
    const { device, done } = await auth.startDeviceLogin({ mode: 'builder-id' })
    expect(device).toMatchObject({ userCode: 'ABCD-EFGH', verificationUriComplete: 'https://device.sso?code=ABCD' })
    const status = await done
    expect(status).toMatchObject({ signedIn: true, mode: 'builder-id', provider: 'AWS Builder ID' })
    expect(calls[0].body).toMatchObject({ clientName: 'Pawn', clientType: 'public', grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'] })
    expect(calls[0].body.scopes).toContain('codewhisperer:conversations')
    expect(calls[1].body).toMatchObject({ startUrl: 'https://view.awsapps.com/start' })
    expect(sleeps).toEqual([1000, 1000, 6000]) // slow_down adds 5s
    expect(await auth.access()).toEqual({ kind: 'bearer', token: 'at1', region: 'us-east-1' })
    now += 3_100_000 // within 10 min of expiry → refresh
    expect((await auth.access()).token).toBe('at2')
    expect(calls.at(-1)!.body).toEqual({ grantType: 'refresh_token', clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt1' })
    expect(m.get()).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2' })
  })

  it('reports expired / denied codes and failed refreshes clearly', async () => {
    const fetchFn = (async (url: string) => {
      if (url.endsWith('/client/register')) return new Response(JSON.stringify({ clientId: 'c', clientSecret: 's' }))
      if (url.endsWith('/device_authorization')) return new Response(JSON.stringify({ deviceCode: 'd', userCode: 'U', verificationUri: 'https://x', interval: 1, expiresIn: 60 }))
      return new Response(JSON.stringify({ error: 'access_denied' }), { status: 400 })
    }) as unknown as typeof fetch
    const auth = new KiroAuth(memStore().store, { fetch: fetchFn, sleep: async () => {} })
    const { done } = await auth.startDeviceLogin({ mode: 'builder-id' })
    await expect(done).rejects.toMatchObject({ code: 'denied' })
    const expired = new KiroAuth(memStore({ mode: 'builder-id', region: 'us-east-1', accessToken: 'a', refreshToken: 'r', clientId: 'c', clientSecret: 's', expiresAt: 0 }).store, {
      fetch: (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as unknown as typeof fetch
    })
    await expect(expired.access()).rejects.toMatchObject({ code: 'expired' })
    await expect(new KiroAuth(memStore().store).access()).rejects.toBeInstanceOf(KiroAuthError)
    await expect(new KiroAuth(memStore().store).setApiKey('sk-not-kiro')).rejects.toThrow(/ksk_/)
    const withKey = new KiroAuth(memStore().store)
    await withKey.setApiKey('ksk_abcdefghijkl', 'eu-central-1')
    expect(await withKey.access()).toEqual({ kind: 'api-key', token: 'ksk_abcdefghijkl', region: 'eu-central-1' })
  })

  describe('import (read-only)', () => {
    const home = mkdtempSync(join(tmpdir(), 'pawn-kiro-home-'))
    afterAll(() => rmSync(home, { recursive: true, force: true }))
    const dbDir = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'kiro-cli') : join(home, '.local', 'share', 'kiro-cli')
    const writeCli = (token: Record<string, unknown>) => {
      mkdirSync(dbDir, { recursive: true })
      rmSync(join(dbDir, 'data.sqlite3'), { force: true })
      const db = new Database(join(dbDir, 'data.sqlite3'))
      db.exec('CREATE TABLE auth_kv (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT)')
      db.prepare('INSERT INTO auth_kv VALUES (?, ?)').run('kirocli:social:token', JSON.stringify(token))
      db.prepare('INSERT INTO state VALUES (?, ?)').run('api.codewhisperer.profile', JSON.stringify({ arn: 'arn:aws:codewhisperer:eu-central-1:123:profile/P' }))
      db.close()
    }
    const open = (p: string) => new Database(p, { readonly: true, fileMustExist: true }) as never

    it('reads the Kiro CLI login and the profile ARN / region', () => {
      writeCli({ access_token: 'cli-at', refresh_token: 'cli-rt', expires_at: '2099-01-01T00:00:00.123456789Z', provider: 'google' })
      const c = readKiroCliLogin(open, home)
      expect(c).toMatchObject({ mode: 'import', importSource: 'kiro-cli', accessToken: 'cli-at', region: 'eu-central-1', profileArn: 'arn:aws:codewhisperer:eu-central-1:123:profile/P', provider: 'google' })
      expect(c && 'refreshToken' in c && c.refreshToken).toBeFalsy() // never kept
      expect(parseImportedToken({ accessToken: 'ide', expiresAt: '2099-01-01T00:00:00Z', region: 'us-east-1', authMethod: 'social' }, 'kiro-ide')).toMatchObject({ accessToken: 'ide', importSource: 'kiro-ide' })
    })

    it('never refreshes the imported session — re-reads the source instead', async () => {
      let now = Date.parse('2030-01-01T00:00:00Z')
      writeCli({ access_token: 'old', refresh_token: 'r', expires_at: '2030-01-01T00:30:00Z' })
      const fetchFn = (async () => {
        throw new Error('must not touch the network')
      }) as unknown as typeof fetch
      const auth = new KiroAuth(memStore().store, { fetch: fetchFn, sqlite: open, home, now: () => now })
      await auth.importLogin('kiro-cli')
      expect((await auth.access()).token).toBe('old')
      now = Date.parse('2030-01-01T00:29:50Z') // < 60 s left
      writeCli({ access_token: 'renewed-by-kiro-cli', refresh_token: 'r2', expires_at: '2030-01-01T01:30:00Z' })
      expect((await auth.access()).token).toBe('renewed-by-kiro-cli')
      now = Date.parse('2030-01-01T02:00:00Z')
      await expect(auth.access()).rejects.toThrow(/Kiro CLI login expired/)
    })
  })
})

describe('Kiro client', () => {
  const bearerAuth = (over: Partial<KiroCredentials> = {}) =>
    new KiroAuth(memStore({ mode: 'import', importSource: 'kiro-cli', region: 'us-east-1', accessToken: 'tok', expiresAt: Date.now() + 3_600_000, profileArn: 'arn:aws:codewhisperer:us-east-1:1:profile/X', ...over }).store)

  it('streams text, fragmented tool calls, usage and metering', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, any> }> = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
      return streamResponse(
        concat([
          enc('assistantResponseEvent', { content: 'Let me ' }),
          enc('assistantResponseEvent', { content: 'check.' }),
          enc('toolUseEvent', { toolUseId: 'tu1', name: 'read_file', input: '' }),
          enc('toolUseEvent', { toolUseId: 'tu1', name: 'read_file', input: '{"path":' }),
          enc('toolUseEvent', { toolUseId: 'tu1', name: 'read_file', input: '"a.ts"}' }),
          enc('toolUseEvent', { toolUseId: 'tu1', name: 'read_file', stop: true }),
          enc('toolUseEvent', { toolUseId: 'tu2', name: 'list_dir', input: '{}' }),
          enc('messageMetadataEvent', { conversationId: 'c' }),
          enc('contextUsageEvent', { contextUsagePercentage: 2.5 }),
          enc('meteringEvent', { unit: 'credit', usage: 0.0123 })
        ]),
        5
      )
    }) as unknown as typeof fetch
    const client = new KiroClient(bearerAuth(), { fetch: fetchFn, version: 't' })
    const events: KiroEvent[] = []
    for await (const e of client.chat({ conversationState: { chatTriggerType: 'MANUAL' } })) events.push(e)
    expect(events).toEqual([
      { type: 'text', text: 'Let me ' },
      { type: 'text', text: 'check.' },
      { type: 'toolUse', id: 'tu1', name: 'read_file', input: { path: 'a.ts' } },
      { type: 'usage', contextUsagePercentage: 2.5 },
      { type: 'usage', credits: 0.0123 },
      { type: 'toolUse', id: 'tu2', name: 'list_dir', input: {} }
    ])
    expect(seen[0].url).toBe('https://q.us-east-1.amazonaws.com/generateAssistantResponse')
    expect(seen[0].headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Amz-Target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse', 'Content-Type': 'application/x-amz-json-1.0' })
    expect(seen[0].headers.tokentype).toBeUndefined()
    expect(seen[0].body.profileArn).toBe('arn:aws:codewhisperer:us-east-1:1:profile/X')
  })

  it('surfaces stream exceptions, falls back on 404, and re-reads credentials after a 403', async () => {
    let n = 0
    const urls: string[] = []
    const fetchFn = (async (url: string) => {
      urls.push(url)
      n++
      if (n === 1) return new Response('{"message":"The bearer token included in the request is invalid"}', { status: 403 })
      if (n === 2) return new Response('{"__type":"UnknownOperationException"}', { status: 404 })
      return streamResponse(enc('ThrottlingException', { message: 'slow down' }, 'exception'))
    }) as unknown as typeof fetch
    const auth = bearerAuth()
    let forced = 0
    const orig = auth.access.bind(auth)
    auth.access = async (o?: { forceRefresh?: boolean }) => {
      if (o?.forceRefresh) forced++
      return orig({})
    }
    const client = new KiroClient(auth, { fetch: fetchFn })
    const events: KiroEvent[] = []
    for await (const e of client.chat({ conversationState: {} })) events.push(e)
    expect(forced).toBe(1)
    expect(urls[1]).toBe('https://q.us-east-1.amazonaws.com/generateAssistantResponse')
    expect(urls[2]).toBe('https://runtime.us-east-1.kiro.dev/generateAssistantResponse')
    expect(events).toEqual([{ type: 'error', message: 'Kiro stream ThrottlingException: slow down', transient: true, code: 'ThrottlingException' }])
  })

  it('uses the service root with tokentype: API_KEY for Kiro API keys', async () => {
    const auth = new KiroAuth(memStore({ mode: 'api-key', apiKey: 'ksk_testtesttest', region: 'eu-central-1' }).store)
    const a = await auth.access()
    expect(chatEndpoints(a)).toEqual([{ url: 'https://q.eu-central-1.amazonaws.com/', root: true, needsProfile: false }])
    expect(kiroHeaders(a, 'X', '1')).toMatchObject({ tokentype: 'API_KEY', Authorization: 'Bearer ksk_testtesttest' })
    let body: Record<string, any> = {}
    const client = new KiroClient(auth, {
      fetch: (async (_u: string, init: RequestInit) => ((body = JSON.parse(String(init.body))), streamResponse(enc('assistantResponseEvent', { content: 'ok' })))) as unknown as typeof fetch
    })
    for await (const _e of client.chat({ conversationState: { chatTriggerType: 'MANUAL' } })) void _e
    expect(body).toMatchObject({ agentMode: 'vibe', conversationState: { agentTaskType: 'vibe' } })
    expect(body.profileArn).toBeUndefined()
  })

  it('lists models (paginated) and reads usage limits', async () => {
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (String(init.method) === 'GET') return new Response(JSON.stringify({ usageBreakdownList: [{ currentUsageWithPrecision: 12.5, usageLimitWithPrecision: 1000 }], nextDateReset: 1790812800 }))
      const b = JSON.parse(String(init.body))
      expect((init.headers as Record<string, string>)['X-Amz-Target']).toBe('AmazonCodeWhispererService.ListAvailableModels')
      if (!b.nextToken) return new Response(JSON.stringify({ models: [{ modelId: 'auto', modelName: 'Auto', tokenLimits: { maxInputTokens: 1_000_000 }, supportedInputTypes: ['TEXT', 'IMAGE'], rateMultiplier: 1 }], nextToken: 'p2' }))
      return new Response(JSON.stringify({ models: [{ modelId: 'glm-5', supportedInputTypes: ['TEXT'], rateMultiplier: 0.5 }] }))
    }) as unknown as typeof fetch
    const client = new KiroClient(bearerAuth(), { fetch: fetchFn })
    expect(await client.listModels()).toEqual([
      { modelId: 'auto', modelName: 'Auto', maxInputTokens: 1_000_000, supportsImages: true, rateMultiplier: 1 },
      { modelId: 'glm-5', supportsImages: false, rateMultiplier: 0.5 }
    ])
    expect(await client.usage()).toMatchObject({ used: 12.5, limit: 1000, resetAt: '1790812800' })
  })
})

describe('Kiro service', () => {
  it('streams a chat to emit(), ends with done, and validates input', async () => {
    const got: Array<{ id: string; ev: KiroStreamEvent }> = []
    const m = memStore({ mode: 'import', importSource: 'kiro-cli', region: 'us-east-1', accessToken: 't', expiresAt: Date.now() + 3_600_000 })
    const svc = createKiroService({
      store: m.store,
      fetch: (async () => streamResponse(enc('assistantResponseEvent', { content: 'hi' }))) as unknown as typeof fetch,
      emit: (id, ev) => got.push({ id, ev })
    })
    expect(svc.chatStart('bad id!', { conversationState: {} }).ok).toBe(false)
    expect(svc.chatStart('r1', { nope: 1 }).ok).toBe(false)
    expect(svc.chatStart('r1', { conversationState: {} }).ok).toBe(true)
    const t0 = Date.now()
    while (!got.some((g) => g.ev.type === 'done') && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10))
    expect(got).toEqual([
      { id: 'r1', ev: { type: 'text', text: 'hi' } },
      { id: 'r1', ev: { type: 'done' } }
    ])
    expect(await svc.status()).toMatchObject({ signedIn: true, mode: 'import' })
    await svc.signOut()
    expect(await svc.status()).toEqual({ signedIn: false })
  })
})
