/**
 * Personal Telegram gateway.
 *
 * DM policy is pairing (OpenClaw's default, Hermes's pairing codes): an
 * unknown sender gets a one-time code and no agent turn. The desktop owner
 * approves it in Settings. Group chats are ignored. One long-poll at a time;
 * a 409 from a second poller retries briefly, then stops.
 */

import { randomBytes as cryptoRandom } from 'crypto'
import { botCopy, normalizeLang } from './copy'
import type { AppLang } from '../appLanguage'
import type { BotCopy } from './copy'
import { chunkText, markdownToTelegramHtml, TELEGRAM_TEXT_LIMIT } from './format'
import { createTelegramHttp, messageIdOf, type TelegramHttp } from './api'
import { createFileTelegramStore, type TelegramStore } from './store'
import type { TelegramEvent, TelegramPublicStatus, TelegramState } from './types'

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/
const CHAT_ID = /^-?\d{1,20}$/
const USER_ID = /^\d{1,20}$/
const PROJECT_ID = /^[\w.-]{1,80}$/
// Boot tag in the middle keeps ids unique across app restarts: old Telegram
// buttons can never match a freshly issued permission id again.
const REQUEST_ID_BODY = 'perm-[a-z0-9]{3,16}-\\d{1,8}'
const REQUEST_ID = new RegExp(`^${REQUEST_ID_BODY}$`)
const CALLBACK_DATA = new RegExp(`^p:(ok|no):(${REQUEST_ID_BODY})$`)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAIRING_TTL_MS = 60 * 60 * 1000
const PAIRING_QUIET_MS = 20_000
const POLL_TIMEOUT_SEC = 25
const CONFLICT_RETRIES = 3

export interface TelegramServiceOptions {
  dir: string
  store?: TelegramStore
  http?: TelegramHttp
  now?: () => number
  randomBytes?: (size: number) => Buffer
  notify?: (event: TelegramEvent) => void
  /** Delay between 409 Conflict retries. Tests pass a small value. */
  conflictDelayMs?: number
}

interface TgUser {
  id?: number
  is_bot?: boolean
  username?: string
  first_name?: string
  language_code?: string
}
interface TgChat {
  id?: number
  type?: string
}
interface TgMessage {
  from?: TgUser
  chat?: TgChat
  text?: string
  caption?: string
}
interface TgCallback {
  id?: string
  from?: TgUser
  data?: string
}
interface TgUpdate {
  update_id?: number
  message?: TgMessage
  callback_query?: TgCallback
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

function pairingCode(bytes: Buffer): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

function commandOf(text: string): { name: string; args: string } | null {
  const m = /^\/([a-z0-9_]+)(?:@[\w_]+)?(?:\s|$)/i.exec(text.trim())
  if (!m) return null
  return { name: m[1].toLowerCase(), args: text.trim().slice(m[0].length).trim() }
}

function clipName(v: string | undefined, max: number): string | undefined {
  if (!v) return undefined
  const s = v.replace(/[\u0000-\u001f]/g, '').trim()
  return s ? s.slice(0, max) : undefined
}

export function createTelegramService(opts: TelegramServiceOptions) {
  const store = opts.store ?? createFileTelegramStore(opts.dir)
  const http = opts.http ?? createTelegramHttp()
  const now = opts.now ?? (() => Date.now())
  const randomBytes = opts.randomBytes ?? ((n: number) => cryptoRandom(n))
  const conflictDelayMs = opts.conflictDelayMs ?? 10_000
  let state: TelegramState = store.load()
  let polling = false
  let error: string | undefined
  let generation = 0
  let abort: AbortController | null = null
  let runPromise: Promise<void> | null = null
  const tails = new Map<string, Promise<void>>()
  const statusMessage = new Map<string, number>()

  function emit(event: TelegramEvent): void {
    try {
      opts.notify?.(event)
    } catch {
      /* a listener must not break the poll */
    }
  }

  function persist(): void {
    try {
      store.save(state)
    } catch (err) {
      // Disk failure (ENOSPC, permissions) must not reject inside the poll
      // loop: in-memory state stays authoritative until a save succeeds.
      console.error('[telegram] persist failed:', err)
    }
  }

  function status(): TelegramPublicStatus {
    return {
      ok: true,
      enabled: state.enabled,
      hasToken: !!state.botToken,
      username: state.botUsername,
      projectId: state.projectId,
      allowFrom: state.allowFrom.map((u) => ({ ...u })),
      pending: state.pending.map((p) => ({ ...p })),
      polling,
      error
    }
  }

  /** Chat bindings for the renderer bridge: it re-arms watchers after a restart. */
  function bindings(): { ok: true; bindings: Array<{ chatId: string; projectId: string; sessionId: string; userId: string }> } {
    return {
      ok: true,
      bindings: Object.entries(state.chats).map(([chatId, b]) => ({ chatId, projectId: b.projectId, sessionId: b.sessionId, userId: b.userId }))
    }
  }

  function langForUser(userId: string): AppLang | undefined {
    return state.allowFrom.find((u) => u.userId === userId)?.language
  }

  function copyForUser(userId: string): BotCopy {
    return botCopy(langForUser(userId))
  }

  function enqueue(chatId: string, job: () => Promise<void>): Promise<void> {
    const prev = tails.get(chatId) ?? Promise.resolve()
    const next = prev.then(job, job)
    tails.set(
      chatId,
      next.then(
        () => undefined,
        () => undefined
      )
    )
    return next
  }

  async function call(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ReturnType<TelegramHttp['call']>> {
    const token = state.botToken
    if (!token) return { ok: false, description: 'no_token' }
    try {
      return await http.call(token, method, body, signal)
    } catch (err) {
      if (signal?.aborted) return { ok: false, description: 'aborted' }
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, description: message.includes(token) ? 'transport' : message.slice(0, 180) }
    }
  }

  async function sendRaw(
    chatId: string,
    text: string,
    extra: Record<string, unknown>,
    editId?: number
  ): Promise<{ ok: boolean; messageId?: number }> {
    const method = editId ? 'editMessageText' : 'sendMessage'
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...extra
    }
    if (editId) body.message_id = editId
    let res = await call(method, body)
    if (!res.ok && res.errorCode === 429) {
      await sleep(Math.min(30, res.retryAfter || 1) * 1000, abort?.signal ?? new AbortController().signal)
      res = await call(method, body)
    }
    if (!res.ok) return { ok: false }
    return { ok: true, messageId: messageIdOf(res.result) ?? editId }
  }

  async function deliver(chatId: string, markdown: string, editId?: number): Promise<number | undefined> {
    const pieces = chunkText(markdown).slice(0, 12)
    if (!pieces.length) return undefined
    let firstId = editId
    for (let i = 0; i < pieces.length; i++) {
      const html = markdownToTelegramHtml(pieces[i])
      const useHtml = html.length <= TELEGRAM_TEXT_LIMIT
      const sent = await sendRaw(
        chatId,
        useHtml ? html : pieces[i].slice(0, TELEGRAM_TEXT_LIMIT),
        useHtml ? { parse_mode: 'HTML' } : {},
        i === 0 ? firstId : undefined
      )
      if (!sent.ok && i === 0 && firstId) {
        const again = await sendRaw(chatId, useHtml ? html : pieces[i].slice(0, TELEGRAM_TEXT_LIMIT), useHtml ? { parse_mode: 'HTML' } : {})
        if (again.messageId) firstId = again.messageId
        continue
      }
      if (i === 0 && sent.messageId) firstId = sent.messageId
    }
    return firstId
  }

  function sendText(chatId: string, text: string): Promise<void> {
    return enqueue(chatId, async () => {
      await deliver(chatId, text)
    })
  }

  function allowed(userId: string): boolean {
    return state.allowFrom.some((u) => u.userId === userId)
  }

  function dropExpiredPending(): void {
    const t = now()
    const next = state.pending.filter((p) => t - p.createdAt < PAIRING_TTL_MS)
    if (next.length !== state.pending.length) {
      state = { ...state, pending: next }
      persist()
    }
  }

  async function replyPairing(
    chatId: string,
    user: { userId: string; username?: string; firstName?: string; language?: AppLang }
  ): Promise<void> {
    dropExpiredPending()
    const t = now()
    let pending = state.pending.find((p) => p.userId === user.userId && p.chatId === chatId)
    if (!pending) {
      pending = {
        code: pairingCode(randomBytes(8)),
        userId: user.userId,
        username: user.username,
        firstName: user.firstName,
        chatId,
        createdAt: t,
        language: user.language
      }
      state = { ...state, pending: [...state.pending.filter((p) => p.userId !== user.userId), pending] }
      persist()
      emit({ type: 'pairing', code: pending.code, userId: user.userId, username: user.username, chatId })
    }
    if (pending.lastNotifiedAt && t - pending.lastNotifiedAt < PAIRING_QUIET_MS) return
    pending.lastNotifiedAt = t
    state = { ...state, pending: state.pending.map((p) => (p.code === pending!.code ? pending! : p)) }
    persist()
    const copy = botCopy(user.language)
    await sendText(chatId, copy.pairing(pending.code, user.userId))
  }

  async function handleMessage(msg: TgMessage): Promise<void> {
    const chat = msg.chat
    if (!chat || chat.type !== 'private' || typeof chat.id !== 'number') return
    const from = msg.from
    if (!from || from.is_bot || typeof from.id !== 'number') return
    const userId = String(from.id)
    const chatId = String(chat.id)
    if (!USER_ID.test(userId) || !CHAT_ID.test(chatId)) return
    const username = clipName(from.username, 32)
    const firstName = clipName(from.first_name, 64)
    const language = normalizeLang(from.language_code)

    if (!allowed(userId)) {
      await replyPairing(chatId, { userId, username, firstName, language })
      return
    }

    // Keep the stored client language in sync so bot copy follows the user.
    const entry = state.allowFrom.find((u) => u.userId === userId)
    if (language && entry && entry.language !== language) {
      state = {
        ...state,
        allowFrom: state.allowFrom.map((u) => (u.userId === userId ? { ...u, language } : u))
      }
      persist()
    }
    const copy = copyForUser(userId)

    const text = (typeof msg.text === 'string' ? msg.text : typeof msg.caption === 'string' ? msg.caption : '').trim()
    if (!text) {
      await sendText(chatId, copy.textOnly)
      return
    }
    const clipped = text.slice(0, 8000)
    const cmd = commandOf(clipped)
    const binding = state.chats[chatId]

    if (cmd) {
      switch (cmd.name) {
        case 'start':
        case 'help':
          await sendText(chatId, copy.help)
          return
        case 'whoami':
          await sendText(chatId, copy.whoami(userId))
          return
        case 'status':
          await sendText(chatId, copy.status(polling, state.botUsername))
          return
        case 'new':
          if (binding) {
            const { [chatId]: _drop, ...rest } = state.chats
            state = { ...state, chats: rest }
            persist()
          }
          emit({ type: 'command', name: 'new', chatId, userId, sessionId: binding?.sessionId })
          await sendText(chatId, copy.newChat)
          return
        case 'stop':
          emit({ type: 'command', name: 'stop', chatId, userId, sessionId: binding?.sessionId })
          await sendText(chatId, copy.stopping)
          return
        case 'sessions':
        case 'chat':
        case 'project':
        case 'usage':
        case 'plan':
        case 'build':
        case 'tasks':
        case 'changes':
        case 'undo':
        case 'model':
        case 'compact':
          if (!state.projectId) {
            await sendText(chatId, copy.pickProject)
            return
          }
          emit({
            type: 'command',
            name: cmd.name,
            chatId,
            userId,
            sessionId: binding?.sessionId,
            projectId: state.projectId,
            arg: cmd.args ? cmd.args.slice(0, 2000) : undefined,
            language: langForUser(userId)
          })
          return
        default:
          await sendText(chatId, copy.unknown)
          return
      }
    }
    if (!state.projectId) {
      await sendText(chatId, copy.pickProject)
      return
    }
    emit({
      type: 'inbound',
      chatId,
      userId,
      username,
      text: clipped,
      projectId: state.projectId,
      sessionId: binding?.sessionId,
      language: langForUser(userId)
    })
  }

  async function handleCallback(cq: TgCallback): Promise<void> {
    const from = cq.from
    const userId = from && typeof from.id === 'number' ? String(from.id) : ''
    const data = typeof cq.data === 'string' ? cq.data : ''
    const match = CALLBACK_DATA.exec(data)
    if (cq.id) {
      const copy = copyForUser(userId)
      await call('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: match && allowed(userId) ? undefined : copy.notPaired
      })
    }
    if (!match || !allowed(userId) || !REQUEST_ID.test(match[2])) return
    emit({ type: 'permission', requestId: match[2], approved: match[1] === 'ok' })
  }

  async function handleUpdate(update: TgUpdate): Promise<void> {
    if (update.callback_query) {
      await handleCallback(update.callback_query)
      return
    }
    if (update.message) await handleMessage(update.message)
  }

  /**
   * Register the command list (client autocomplete when typing "/") and the
   * menu button that opens it. Failures stay silent: a stale registration
   * must never keep the gateway offline.
   */
  async function syncMenu(signal: AbortSignal): Promise<void> {
    const langs: Array<{ code?: string; lang: AppLang }> = [
      { lang: 'en' },
      { code: 'ko', lang: 'ko' },
      { code: 'ja', lang: 'ja' },
      { code: 'zh', lang: 'zh' }
    ]
    for (const { code, lang } of langs) {
      const body: Record<string, unknown> = {
        commands: botCopy(lang).commands.map((c) => ({ command: c.command, description: c.description }))
      }
      if (code) body.language_code = code
      const res = await call('setMyCommands', body, signal)
      if (signal.aborted || (!res.ok && res.errorCode === 401)) return
    }
    await call('setChatMenuButton', { menu_button: { type: 'commands' } }, signal)
  }

  async function prepare(signal: AbortSignal): Promise<boolean> {
    const wh = await call('deleteWebhook', { drop_pending_updates: false }, signal)
    if (signal.aborted) return false
    if (!wh.ok && wh.errorCode === 401) {
      error = 'token_rejected'
      emit({ type: 'status' })
      return false
    }
    const me = await call('getMe', {}, signal)
    if (signal.aborted) return false
    if (!me.ok && me.errorCode === 401) {
      error = 'token_rejected'
      emit({ type: 'status' })
      return false
    }
    if (me.ok && me.result && typeof me.result === 'object') {
      const username = clipName((me.result as { username?: string }).username, 32)
      if (username && username !== state.botUsername) {
        state = { ...state, botUsername: username }
        persist()
      }
    }
    await syncMenu(signal)
    if (signal.aborted) return false
    error = undefined
    emit({ type: 'status' })
    return true
  }

  async function poll(gen: number, signal: AbortSignal): Promise<void> {
    let backoff = 1000
    let conflicts = 0
    while (!signal.aborted && gen === generation) {
      const res = await call(
        'getUpdates',
        {
          offset: state.updateOffset,
          timeout: POLL_TIMEOUT_SEC,
          allowed_updates: ['message', 'callback_query']
        },
        signal
      )
      if (signal.aborted || gen !== generation) return
      if (!res.ok) {
        if (res.description === 'aborted') return
        if (res.errorCode === 401) {
          error = 'token_rejected'
          polling = false
          emit({ type: 'status' })
          return
        }
        if (res.errorCode === 409) {
          conflicts += 1
          if (conflicts >= CONFLICT_RETRIES) {
            error = 'conflict'
            polling = false
            emit({ type: 'status' })
            return
          }
          await sleep(conflictDelayMs, signal)
          continue
        }
        error = (res.description || 'transport').slice(0, 180)
        emit({ type: 'status' })
        await sleep(backoff, signal)
        backoff = Math.min(30_000, backoff * 2)
        continue
      }
      backoff = 1000
      conflicts = 0
      if (error) {
        error = undefined
        emit({ type: 'status' })
      }
      const updates = Array.isArray(res.result) ? (res.result as TgUpdate[]) : []
      for (const update of updates) {
        if (signal.aborted || gen !== generation) return
        const next = typeof update.update_id === 'number' ? update.update_id + 1 : state.updateOffset
        if (next > state.updateOffset) {
          // Advance before handling so a crash cannot run the same turn twice.
          state = { ...state, updateOffset: next }
          persist()
        }
        try {
          await handleUpdate(update)
        } catch {
          /* offset already stored */
        }
      }
    }
  }

  async function stop(): Promise<void> {
    generation += 1
    abort?.abort()
    abort = null
    const pending = runPromise
    runPromise = null
    polling = false
    await pending?.catch(() => {})
  }

  async function start(): Promise<void> {
    await stop()
    if (!state.enabled || !state.botToken) return
    const gen = ++generation
    const ac = new AbortController()
    abort = ac
    polling = true
    error = undefined
    let ready = false
    try {
      ready = await prepare(ac.signal)
    } catch {
      if (gen === generation) error = 'transport'
    }
    if (!ready || ac.signal.aborted || gen !== generation) {
      if (gen === generation) polling = false
      emit({ type: 'status' })
      return
    }
    runPromise = poll(gen, ac.signal).finally(() => {
      if (gen === generation) polling = false
    })
  }

  async function setEnabled(enabled: boolean): Promise<TelegramPublicStatus> {
    state = { ...state, enabled }
    persist()
    if (enabled) await start()
    else await stop()
    emit({ type: 'status' })
    return status()
  }

  async function setToken(token: unknown): Promise<TelegramPublicStatus | { ok: false; error: string }> {
    if (typeof token !== 'string' || !TOKEN_RE.test(token.trim())) return { ok: false, error: 'invalid_token' }
    state = { ...state, botToken: token.trim(), botUsername: undefined }
    error = undefined
    persist()
    if (state.enabled) await start()
    emit({ type: 'status' })
    return status()
  }

  async function clearToken(): Promise<TelegramPublicStatus> {
    await stop()
    state = { ...state, botToken: undefined, botUsername: undefined, enabled: false }
    error = undefined
    persist()
    emit({ type: 'status' })
    return status()
  }

  function setProject(projectId: unknown): TelegramPublicStatus | { ok: false; error: string } {
    if (typeof projectId !== 'string' || (projectId !== '' && !PROJECT_ID.test(projectId))) {
      return { ok: false, error: 'bad_project' }
    }
    state = { ...state, projectId }
    persist()
    emit({ type: 'status' })
    return status()
  }

  async function approve(code: unknown): Promise<TelegramPublicStatus | { ok: false; error: string }> {
    if (typeof code !== 'string') return { ok: false, error: 'not_found' }
    dropExpiredPending()
    const pending = state.pending.find((p) => p.code === code)
    if (!pending) return { ok: false, error: 'not_found' }
    const user = {
      userId: pending.userId,
      username: pending.username,
      firstName: pending.firstName,
      approvedAt: now(),
      language: pending.language
    }
    state = {
      ...state,
      pending: state.pending.filter((p) => p.code !== code),
      allowFrom: [...state.allowFrom.filter((u) => u.userId !== user.userId), user]
    }
    persist()
    emit({ type: 'status' })
    await sendText(pending.chatId, botCopy().paired)
    return status()
  }

  function deny(code: unknown): TelegramPublicStatus | { ok: false; error: string } {
    if (typeof code !== 'string' || !state.pending.some((p) => p.code === code)) {
      return { ok: false, error: 'not_found' }
    }
    state = { ...state, pending: state.pending.filter((p) => p.code !== code) }
    persist()
    emit({ type: 'status' })
    return status()
  }

  function revoke(userId: unknown): TelegramPublicStatus | { ok: false; error: string } {
    if (typeof userId !== 'string' || !USER_ID.test(userId)) return { ok: false, error: 'not_found' }
    state = { ...state, allowFrom: state.allowFrom.filter((u) => u.userId !== userId) }
    persist()
    emit({ type: 'status' })
    return status()
  }

  /** Pre-approve a numeric user id without the pairing round trip. */
  function allowUser(userId: unknown): TelegramPublicStatus | { ok: false; error: string } {
    if (typeof userId !== 'string' || !USER_ID.test(userId.trim())) return { ok: false, error: 'bad_user' }
    const id = userId.trim()
    if (!state.allowFrom.some((u) => u.userId === id)) {
      state = {
        ...state,
        allowFrom: [...state.allowFrom, { userId: id, approvedAt: now() }],
        pending: state.pending.filter((p) => p.userId !== id)
      }
      persist()
      emit({ type: 'status' })
    }
    return status()
  }

  function bindChat(
    chatId: unknown,
    projectId: unknown,
    sessionId: unknown,
    userId?: unknown
  ): { ok: true } | { ok: false; error: string } {
    if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return { ok: false, error: 'bad_chat' }
    if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return { ok: false, error: 'bad_project' }
    if (typeof sessionId !== 'string' || !PROJECT_ID.test(sessionId)) return { ok: false, error: 'bad_session' }
    const prev = state.chats[chatId]
    const boundUser =
      typeof userId === 'string' && USER_ID.test(userId) ? userId : prev?.userId && prev.userId !== '0' ? prev.userId : '0'
    state = {
      ...state,
      chats: {
        ...state.chats,
        [chatId]: { projectId, sessionId, userId: boundUser }
      }
    }
    persist()
    return { ok: true }
  }

  function reply(chatId: unknown, text: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return Promise.resolve({ ok: false, error: 'bad_chat' })
    if (typeof text !== 'string' || !text.trim()) return Promise.resolve({ ok: false, error: 'empty' })
    const body = text.slice(0, 100_000)
    return enqueue(chatId, async () => {
      const editId = statusMessage.get(chatId)
      statusMessage.delete(chatId)
      await deliver(chatId, body, editId)
    }).then(() => ({ ok: true as const }))
  }

  function progress(chatId: unknown, text: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return Promise.resolve({ ok: false, error: 'bad_chat' })
    if (typeof text !== 'string' || !text.trim()) return Promise.resolve({ ok: false, error: 'empty' })
    const body = text.trim().slice(0, 3500)
    return enqueue(chatId, async () => {
      const existing = statusMessage.get(chatId)
      let sent = await sendRaw(chatId, body, {}, existing)
      if (!sent.ok && existing) {
        statusMessage.delete(chatId)
        sent = await sendRaw(chatId, body, {})
      }
      if (sent.messageId) statusMessage.set(chatId, sent.messageId)
    }).then(() => ({ ok: true as const }))
  }

  function askPermission(
    chatId: unknown,
    requestId: unknown,
    summary: unknown
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return Promise.resolve({ ok: false, error: 'bad_chat' })
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return Promise.resolve({ ok: false, error: 'bad_request' })
    const text = typeof summary === 'string' ? summary.slice(0, 3000) : ''
    const copy = copyForUser(state.chats[chatId]?.userId || '')
    return enqueue(chatId, async () => {
      await sendRaw(chatId, copy.permission(text).slice(0, TELEGRAM_TEXT_LIMIT), {
        reply_markup: {
          inline_keyboard: [[
            { text: copy.allow, callback_data: `p:ok:${requestId}` },
            { text: copy.deny, callback_data: `p:no:${requestId}` }
          ]]
        }
      })
    }).then(() => ({ ok: true as const }))
  }

  return {
    status,
    bindings,
    setEnabled,
    setToken,
    clearToken,
    setProject,
    approve,
    deny,
    revoke,
    allowUser,
    bindChat,
    reply,
    progress,
    askPermission,
    start,
    stop,
    /** Test seam: directory of the sealed file, not the token. */
    configPath: opts.dir
  }
}

export type TelegramService = ReturnType<typeof createTelegramService>
