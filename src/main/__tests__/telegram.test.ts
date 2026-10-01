import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
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

import { chunkText, markdownToTelegramHtml } from '../telegram/format'
import { createTelegramService, type TelegramService } from '../telegram/service'
import type { TelegramHttp } from '../telegram/api'
import { createFileTelegramStore } from '../telegram/store'
import { EMPTY_TELEGRAM_STATE, type TelegramEvent, type TelegramState } from '../telegram/types'

const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUV'

function memoryStore(initial?: Partial<TelegramState>) {
  let cfg: TelegramState = {
    ...EMPTY_TELEGRAM_STATE,
    allowFrom: [],
    pending: [],
    chats: {},
    ...initial
  }
  return {
    load: (): TelegramState => structuredClone(cfg),
    save: (s: TelegramState) => {
      cfg = structuredClone(s)
    },
    get: () => cfg
  }
}

interface Script {
  http: TelegramHttp
  calls: Array<{ method: string; body: Record<string, unknown> }>
}

function scripted(
  handler: (
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<{ ok: boolean; errorCode?: number; description?: string; result?: unknown }> | { ok: boolean; errorCode?: number; description?: string; result?: unknown }
): Script {
  const calls: Script['calls'] = []
  const http: TelegramHttp = {
    call: async (_token, method, body, signal) => {
      calls.push({ method, body })
      return handler(method, body, signal)
    }
  }
  return { http, calls }
}

function hang(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
  })
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const services: TelegramService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.stop()))
})

function privateMessage(updateId: number, text: string, userId = 42, languageCode?: string) {
  return {
    update_id: updateId,
    message: {
      text,
      from: {
        id: userId,
        username: 'ada',
        first_name: 'Ada',
        ...(languageCode ? { language_code: languageCode } : {})
      },
      chat: { id: userId, type: 'private' }
    }
  }
}

describe('telegram format', () => {
  it('escapes html and keeps a small markdown subset', () => {
    const html = markdownToTelegramHtml('**hi** `<script>`\n```ts\nconst a = 1 < 2\n```\n[docs](https://example.com/a)')
    expect(html).toContain('<b>hi</b>')
    expect(html).toContain('<code>&lt;script&gt;</code>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<pre>const a = 1 &lt; 2</pre>')
    expect(html).toContain('<a href="https://example.com/a">docs</a>')
  })

  it('chunks long text under the telegram limit', () => {
    const parts = chunkText(`${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}\n\n${'c'.repeat(2000)}`)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(3900)
    expect(parts.join('')).toContain('ccc')
  })
})

describe('telegram gateway', () => {
  it('seals the token and never puts it on the status object', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawn-tg-'))
    try {
      const svc = createTelegramService({ dir, http: scripted(() => ({ ok: true, result: true })).http })
      services.push(svc)
      expect(await svc.setToken('nope')).toEqual({ ok: false, error: 'invalid_token' })
      const saved = await svc.setToken(TOKEN)
      expect(saved).toMatchObject({ ok: true, hasToken: true })
      expect(JSON.stringify(saved)).not.toContain(TOKEN)
      const raw = readFileSync(join(dir, 'telegram.json'), 'utf8')
      expect(raw).not.toContain(TOKEN)
      expect(raw).toContain('enc:v1:')
      expect(statSync(join(dir, 'telegram.json')).mode & 0o777).toBe(0o600)
      const again = createFileTelegramStore(dir).load()
      expect(again.botToken).toBe(TOKEN)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pairs an unknown DM and does not run the agent', async () => {
    const events: TelegramEvent[] = []
    let polls = 0
    const { http, calls } = scripted((method, _body, signal) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') {
        polls += 1
        if (polls === 1) {
          return {
            ok: true,
            result: [
              privateMessage(10, 'hello', 42, 'ko-KR'),
              privateMessage(11, 'hello again'),
              { update_id: 12, message: { text: 'noise', from: { id: 7 }, chat: { id: -100, type: 'group' } } }
            ]
          }
        }
        return hang(signal)
      }
      if (method === 'sendMessage') return { ok: true, result: { message_id: 5 } }
      return { ok: true, result: true }
    })
    const store = memoryStore()
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store,
      http,
      now: () => 1_700_000_000_000,
      randomBytes: () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
      notify: (e) => events.push(e),
      conflictDelayMs: 1
    })
    services.push(svc)
    await svc.setToken(TOKEN)
    await svc.setProject('proj-1')
    await svc.setEnabled(true)
    await waitFor(() => events.some((e) => e.type === 'pairing') && calls.some((c) => c.method === 'sendMessage'))
    expect(events.some((e) => e.type === 'inbound')).toBe(false)
    const sent = calls.filter((c) => c.method === 'sendMessage')
    expect(sent).toHaveLength(1)
    expect(String(sent[0].body.text)).toContain('ABCDEFGH')
    // Bot copy follows the sender's Telegram client language, not the app's.
    expect(String(sent[0].body.text)).toContain('페어링 코드')
    expect(store.get().pending[0]?.userId).toBe('42')
    expect(store.get().pending[0]?.language).toBe('ko')
    expect(store.get().updateOffset).toBe(13)
  })

  it('allows a user id by hand, clears their pending code, and skips pairing', async () => {
    const events: TelegramEvent[] = []
    let polls = 0
    const { http, calls } = scripted((method, _body, signal) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') {
        polls += 1
        if (polls === 1) return { ok: true, result: [privateMessage(1, 'run the tests')] }
        return hang(signal)
      }
      return { ok: true, result: true }
    })
    const store = memoryStore({
      pending: [{ code: 'ABCD2345', userId: '42', chatId: '42', createdAt: 1 }]
    })
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store,
      http,
      now: () => 1_700_000_000_000,
      notify: (e) => events.push(e),
      conflictDelayMs: 1
    })
    services.push(svc)
    expect(await svc.allowUser('not-a-number')).toEqual({ ok: false, error: 'bad_user' })
    expect(await svc.allowUser('42')).toMatchObject({ ok: true, allowFrom: [{ userId: '42' }] })
    expect(store.get().allowFrom).toEqual([{ userId: '42', approvedAt: 1_700_000_000_000 }])
    expect(store.get().pending).toEqual([])
    await svc.setToken(TOKEN)
    await svc.setProject('proj-1')
    await svc.setEnabled(true)
    await waitFor(() => events.some((e) => e.type === 'inbound'))
    expect(events.some((e) => e.type === 'pairing')).toBe(false)
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0)
  })

  it('forwards data commands with their args to the renderer', async () => {
    const events: TelegramEvent[] = []
    let polls = 0
    const { http } = scripted((method, _body, signal) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') {
        polls += 1
        if (polls === 1) {
          return {
            ok: true,
            result: [
              privateMessage(1, '/sessions'),
              privateMessage(2, '/chat 2'),
              privateMessage(3, '/project'),
              privateMessage(4, '/usage'),
              privateMessage(5, '/plan'),
              privateMessage(6, '/build'),
              privateMessage(7, '/tasks'),
              privateMessage(8, '/changes'),
              privateMessage(9, '/undo 1'),
              privateMessage(10, '/model'),
              privateMessage(11, '/compact')
            ]
          }
        }
        return hang(signal)
      }
      return { ok: true, result: true }
    })
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store: memoryStore({ allowFrom: [{ userId: '42', approvedAt: 1 }], projectId: 'proj-1' }),
      http,
      notify: (e) => events.push(e),
      conflictDelayMs: 1
    })
    services.push(svc)
    await svc.setToken(TOKEN)
    await svc.setEnabled(true)
    await waitFor(() => events.filter((e) => e.type === 'command').length >= 11)
    expect(events.filter((e) => e.type === 'command')).toEqual([
      expect.objectContaining({ type: 'command', name: 'sessions', chatId: '42', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'chat', arg: '2', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'project', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'usage', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'plan', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'build', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'tasks', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'changes', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'undo', arg: '1', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'model', projectId: 'proj-1' }),
      expect.objectContaining({ type: 'command', name: 'compact', projectId: 'proj-1' })
    ])
    expect(events.some((e) => e.type === 'inbound')).toBe(false)
  })

  it('exposes persisted chat bindings for the renderer bridge', async () => {
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store: memoryStore(),
      http: scripted(() => ({ ok: true, result: true })).http
    })
    services.push(svc)
    expect(svc.bindings()).toEqual({ ok: true, bindings: [] })
    svc.bindChat('42', 'proj-1', 'sess-1', '42')
    svc.bindChat('-100200', 'proj-1', 'sess-2', '43')
    expect(svc.bindings()).toEqual({
      ok: true,
      bindings: [
        { chatId: '42', projectId: 'proj-1', sessionId: 'sess-1', userId: '42' },
        { chatId: '-100200', projectId: 'proj-1', sessionId: 'sess-2', userId: '43' }
      ]
    })
  })

  it('runs a paired message in the selected project and ignores slash commands', async () => {
    const events: TelegramEvent[] = []
    let polls = 0
    const { http } = scripted((method, _body, signal) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') {
        polls += 1
        if (polls === 1) {
          return {
            ok: true,
            result: [privateMessage(1, 'fix the tests'), privateMessage(2, '/help'), privateMessage(3, '/new')]
          }
        }
        return hang(signal)
      }
      if (method === 'sendMessage') return { ok: true, result: { message_id: 1 } }
      return { ok: true, result: true }
    })
    const store = memoryStore({
      allowFrom: [{ userId: '42', approvedAt: 1, language: 'ko' }],
      projectId: 'proj-1',
      chats: { '42': { projectId: 'proj-1', sessionId: 'sess-1', userId: '42' } }
    })
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store,
      http,
      notify: (e) => events.push(e),
      conflictDelayMs: 1
    })
    services.push(svc)
    await svc.setToken(TOKEN)
    await svc.setEnabled(true)
    await waitFor(() => events.some((e) => e.type === 'command'))
    expect(events.filter((e) => e.type === 'inbound')).toEqual([
      expect.objectContaining({
        type: 'inbound',
        text: 'fix the tests',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        language: 'ko'
      })
    ])
    expect(events).toContainEqual(expect.objectContaining({ type: 'command', name: 'new', chatId: '42' }))
    expect(store.get().chats['42']).toBeUndefined()
  })

  it('asks for a project before dispatching', async () => {
    const events: TelegramEvent[] = []
    let polls = 0
    const { http, calls } = scripted((method, _body, signal) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') {
        polls += 1
        if (polls === 1) return { ok: true, result: [privateMessage(1, 'do the thing')] }
        return hang(signal)
      }
      if (method === 'sendMessage') return { ok: true, result: { message_id: 1 } }
      return { ok: true, result: true }
    })
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store: memoryStore({ allowFrom: [{ userId: '42', approvedAt: 1 }] }),
      http,
      notify: (e) => events.push(e)
    })
    services.push(svc)
    await svc.setToken(TOKEN)
    await svc.setEnabled(true)
    await waitFor(() => calls.some((c) => c.method === 'sendMessage'))
    expect(events.some((e) => e.type === 'inbound')).toBe(false)
    expect(String(calls.find((c) => c.method === 'sendMessage')?.body.text)).toMatch(/project/i)
  })

  it('registers the command menu for autocomplete after a successful start', async () => {
    const { http, calls } = scripted((method, _body, signal) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') return hang(signal)
      return { ok: true, result: true }
    })
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store: memoryStore(),
      http,
      conflictDelayMs: 1
    })
    services.push(svc)
    await svc.setToken(TOKEN)
    await svc.setEnabled(true)
    await waitFor(() => calls.some((c) => c.method === 'setChatMenuButton'))
    const registered = calls.filter((c) => c.method === 'setMyCommands')
    expect(registered).toHaveLength(4)
    const byLang = (code?: string) => registered.find((c) => c.body.language_code === code)!
    const names = (byLang().body.commands as Array<{ command: string }>).map((c) => c.command)
    expect(names).toEqual([
      'new', 'stop', 'plan', 'build', 'sessions', 'chat', 'tasks', 'changes', 'undo',
      'model', 'compact', 'project', 'usage', 'status', 'whoami', 'help'
    ])
    const koCommands = byLang('ko').body.commands as Array<{ command: string; description: string }>
    expect(koCommands[0].description.length).toBeGreaterThan(0)
    for (const code of ['ko', 'ja', 'zh']) expect(byLang(code).body.language_code).toBe(code)
    const menu = calls.find((c) => c.method === 'setChatMenuButton')!
    expect((menu.body.menu_button as { type: string }).type).toBe('commands')
  })

  it('stops after a rejected token or repeated polling conflicts', async () => {
    const rejected = scripted((method) => {
      if (method === 'getMe') return { ok: false, errorCode: 401, description: 'Unauthorized' }
      return { ok: true, result: true }
    })
    const bad = createTelegramService({ dir: '/tmp/unused', store: memoryStore(), http: rejected.http })
    services.push(bad)
    await bad.setToken(TOKEN)
    await bad.setEnabled(true)
    expect(bad.status().error).toBe('token_rejected')
    expect(bad.status().polling).toBe(false)
    expect(rejected.calls.some((c) => c.method === 'getUpdates')).toBe(false)

    let conflicts = 0
    const fighting = scripted((method) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') {
        conflicts += 1
        return { ok: false, errorCode: 409, description: 'Conflict: terminated by other getUpdates request' }
      }
      return { ok: true, result: true }
    })
    const clash = createTelegramService({
      dir: '/tmp/unused',
      store: memoryStore(),
      http: fighting.http,
      conflictDelayMs: 1
    })
    services.push(clash)
    await clash.setToken(TOKEN)
    await clash.setEnabled(true)
    await waitFor(() => clash.status().error === 'conflict')
    expect(clash.status().polling).toBe(false)
    expect(conflicts).toBe(3)
  })

  it('forwards an allow button only from a paired user', async () => {
    const events: TelegramEvent[] = []
    let polls = 0
    const { http, calls } = scripted((method, _body, signal) => {
      if (method === 'getMe') return { ok: true, result: { username: 'pawn_bot' } }
      if (method === 'getUpdates') {
        polls += 1
        if (polls === 1) {
          return {
            ok: true,
            result: [
              { update_id: 1, callback_query: { id: 'c1', from: { id: 99 }, data: 'p:ok:perm-b21xd-4' } },
              { update_id: 2, callback_query: { id: 'c2', from: { id: 42 }, data: 'p:ok:perm-b21xd-4' } }
            ]
          }
        }
        return hang(signal)
      }
      return { ok: true, result: true }
    })
    const svc = createTelegramService({
      dir: '/tmp/unused',
      store: memoryStore({ allowFrom: [{ userId: '42', approvedAt: 1 }] }),
      http,
      notify: (e) => events.push(e)
    })
    services.push(svc)
    await svc.setToken(TOKEN)
    await svc.setEnabled(true)
    await waitFor(() => events.some((e) => e.type === 'permission'))
    expect(events.filter((e) => e.type === 'permission')).toEqual([
      { type: 'permission', requestId: 'perm-b21xd-4', approved: true }
    ])
    const answers = calls.filter((c) => c.method === 'answerCallbackQuery')
    expect(answers).toHaveLength(2)
  })

  it('sends replies as escaped html and edits the working bubble', async () => {
    const { http, calls } = scripted((method) => {
      if (method === 'sendMessage' || method === 'editMessageText') return { ok: true, result: { message_id: 9 } }
      return { ok: true, result: true }
    })
    const svc = createTelegramService({ dir: '/tmp/unused', store: memoryStore(), http })
    services.push(svc)
    await svc.setToken(TOKEN)
    await svc.progress('42', 'Working')
    await svc.reply('42', '**<script>** alert')
    const edit = calls.find((c) => c.method === 'editMessageText')
    expect(edit?.body.parse_mode).toBe('HTML')
    expect(String(edit?.body.text)).toContain('&lt;script&gt;')
    expect(String(edit?.body.text)).not.toContain('<script>')
    expect(edit?.body.message_id).toBe(9)
  })
})
