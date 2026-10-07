/**
 * Runs a Telegram DM as a normal Pawn chat. The main process only polls and
 * delivers; the agent loop stays in the renderer, same permissions as a
 * desktop turn. Remote chats do not steal the window focus.
 */

import { tx } from '../i18n'
import { useAppStore, type Session } from './app'
import { compactSessionNow, useChatStore } from './chat'
import { useChangeLedger, type TurnCheckpoint } from './changeLedger'
import { usePlanStore } from './plan'
import { useProviderStore } from './provider'
import { useUsageStore } from './usage'
import { usePermissionStore } from './permission'

const TURN_WAIT_MS = 45 * 60 * 1000
const CHAT_ID = /^-?\d{1,20}$/
const SESSIONS_SHOWN = 8
const TURNS_SHOWN = 8
const PROGRESS_EVERY_MS = 2500
const PLAN_MARK: Record<string, string> = { pending: '○', in_progress: '●', done: '✓', cancelled: '—' }

export interface ReplyMessage {
  role: string
  content: string
  toolMeta?: unknown
}

/** The assistant text that answers this Telegram message, else a system error. */
export function telegramReplyText(messages: ReplyMessage[], needle: string): string {
  const body = needle.trim()
  let start = messages.length
  if (body) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (
        m.role === 'user' &&
        m.content.startsWith('[Telegram ') &&
        (m.content.endsWith(body) || m.content.includes(`\n${body}`))
      ) {
        start = i + 1
        break
      }
    }
  }
  const slice = messages.slice(start)
  for (let i = slice.length - 1; i >= 0; i--) {
    const m = slice[i]
    if (m.role === 'assistant' && !m.toolMeta && m.content.trim()) return m.content.trim()
  }
  for (let i = slice.length - 1; i >= 0; i--) {
    if (slice[i].role === 'system' && slice[i].content.trim()) return slice[i].content.trim()
  }
  return ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureProjects(): Promise<void> {
  if (!useAppStore.getState().initialized) await useAppStore.getState().init()
}

async function waitUntilLoaded(sessionId: string): Promise<void> {
  const start = Date.now()
  while (!useAppStore.getState().loadedSessions.has(sessionId) && Date.now() - start < 10_000) {
    await sleep(40)
  }
}

async function waitUntilIdle(sessionId: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const chat = useChatStore.getState()
    const queued = chat.queue.some((q) => q.sessionId === sessionId)
    if (!chat.isSessionStreaming(sessionId) && !queued) return true
    await sleep(400)
  }
  return false
}

const tails = new Map<string, Promise<void>>()
const sessionByChat = new Map<string, string>()

function enqueue(chatId: string, job: () => Promise<void>): void {
  const prev = tails.get(chatId) ?? Promise.resolve()
  const next = prev.then(job, job)
  tails.set(
    chatId,
    next.then(
      () => undefined,
      () => undefined
    )
  )
}

function chatsForSession(sessionId: string): string[] {
  const out: string[] = []
  for (const [chatId, id] of sessionByChat) {
    if (id === sessionId) out.push(chatId)
  }
  return out
}

/** Last assistant (or system error) text of a session — the answer a resumed turn owes. */
function lastAnswerText(messages: ReplyMessage[] | undefined): string {
  const list = messages || []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.role === 'assistant' && !m.toolMeta && m.content.trim()) return m.content.trim()
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'system' && list[i].content.trim()) return list[i].content.trim()
  }
  return ''
}

/**
 * After a restart the loop resumes before this bridge exists, so the reply
 * the chat is owed would be lost. Re-bind every persisted chat and, when a
 * bound session is actually busy, deliver the answer once it settles.
 */
async function watchResumedTurns(): Promise<void> {
  const api = window.api?.telegram
  if (!api?.bindings) return
  const res = await api.bindings().catch(() => undefined)
  for (const b of res?.bindings || []) {
    if (!CHAT_ID.test(b.chatId) || !b.sessionId) continue
    sessionByChat.set(b.chatId, b.sessionId)
    void watchResumedTurn(api, b.chatId, b.sessionId).catch(() => {})
  }
}

async function watchResumedTurn(
  api: NonNullable<Window['api']['telegram']>,
  chatId: string,
  sessionId: string
): Promise<void> {
  let busy = false
  // The resume path starts streaming slightly after boot; look for it briefly.
  for (let waited = 0; waited < 10_000 && !busy; waited += 1000) {
    const chat = useChatStore.getState()
    busy = chat.isSessionStreaming(sessionId) || chat.queue.some((q) => q.sessionId === sessionId)
    if (!busy) await sleep(1000)
  }
  if (!busy) return
  await waitUntilIdle(sessionId, TURN_WAIT_MS)
  const session = useAppStore
    .getState()
    .projects.find((p) => p.sessions.some((s) => s.id === sessionId))
    ?.sessions.find((s) => s.id === sessionId)
  const answer = lastAnswerText(session?.messages)
  if (answer) await api.reply(chatId, answer).catch(() => {})
}

async function ensureSession(ev: {
  chatId: string
  userId: string
  username?: string
  projectId: string
  sessionId?: string
}): Promise<{ projectId: string; sessionId: string } | { error: string }> {
  await ensureProjects()
  const app = useAppStore.getState()
  const project = app.projects.find((p) => p.id === ev.projectId)
  if (!project || project.paths.length === 0) {
    return { error: 'That project is not open in Pawn, or it has no folder. Pick one under Settings → Telegram.' }
  }
  let sessionId = ev.sessionId && project.sessions.some((s) => s.id === ev.sessionId) ? ev.sessionId : ''
  if (!sessionId) {
    const title = ev.username ? `Telegram @${ev.username}` : `Telegram ${ev.userId}`
    sessionId = app.addSession(project.id, title, { focus: false })
    await window.api?.telegram?.bindChat(ev.chatId, project.id, sessionId, ev.userId)?.catch?.(() => {})
  }
  sessionByChat.set(ev.chatId, sessionId)
  if (!useAppStore.getState().loadedSessions.has(sessionId)) {
    await useAppStore.getState().loadMessages(project.id, sessionId)
    await waitUntilLoaded(sessionId)
  }
  return { projectId: project.id, sessionId }
}

async function runInbound(ev: Extract<TelegramEventDto, { type: 'inbound' }>): Promise<void> {
  const api = window.api?.telegram
  if (!api) return
  const bound = await ensureSession(ev)
  if ('error' in bound) {
    await api.reply(ev.chatId, bound.error).catch(() => {})
    return
  }
  const label = ev.username ? `@${ev.username}` : ev.userId
  const content = `[Telegram ${label}]\n${ev.text}`
  useChatStore.getState().sendMessage(bound.projectId, bound.sessionId, content, 'queue')
  await api.progress(ev.chatId, 'Working…').catch(() => {})

  // Edit the working bubble only when the interim answer changed: editing the
  // same text every tick would burn the bot's rate limit on long turns.
  let lastDraft = ''
  const timer = setInterval(() => {
    const session = useAppStore
      .getState()
      .projects.find((p) => p.id === bound.projectId)
      ?.sessions.find((s) => s.id === bound.sessionId)
    const draft = telegramReplyText(session?.messages || [], ev.text)
    const clipped = draft.slice(0, 3500)
    if (clipped && clipped !== lastDraft) {
      lastDraft = clipped
      void api.progress(ev.chatId, clipped).catch(() => {})
    }
  }, PROGRESS_EVERY_MS)

  try {
    const idle = await waitUntilIdle(bound.sessionId, TURN_WAIT_MS)
    if (!idle && !lastDraft) {
      await api.progress(ev.chatId, 'Still working in Pawn. The answer will arrive when the turn finishes.').catch(() => {})
      await waitUntilIdle(bound.sessionId, TURN_WAIT_MS)
    }
  } finally {
    clearInterval(timer)
  }

  const session = useAppStore
    .getState()
    .projects.find((p) => p.id === bound.projectId)
    ?.sessions.find((s) => s.id === bound.sessionId)
  const answer = telegramReplyText(session?.messages || [], ev.text) || 'Done. The trace is in this chat inside Pawn.'
  await api.reply(ev.chatId, answer).catch(() => {})
}

type DataCommand = Extract<TelegramEventDto, { type: 'command' }>

function projectOf(projectId: string) {
  return useAppStore.getState().projects.find((p) => p.id === projectId)
}

/** Most recent first; a session without loaded messages falls back to its creation time. */
function recentSessions(projectId: string): Session[] {
  const project = projectOf(projectId)
  if (!project) return []
  const lastActivity = (s: Session): number => {
    const last = s.messages[s.messages.length - 1]
    return Math.max(s.createdAt, last?.createdAt ?? 0)
  }
  return [...project.sessions].sort((a, b) => lastActivity(b) - lastActivity(a) || a.id.localeCompare(b.id))
}

function kTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

/** /sessions /chat <n> /project /usage — quick reads answered without an agent turn. */
async function runDataCommand(ev: DataCommand): Promise<void> {
  const api = window.api?.telegram
  if (!api) return
  await ensureProjects()
  const project = projectOf(ev.projectId || '')
  if (!project) {
    await api.reply(ev.chatId, 'That project is not open in Pawn, or it has no folder. Pick one under Settings → Telegram.').catch(() => {})
    return
  }
  const sessionId = sessionByChat.get(ev.chatId) || ev.sessionId || ''
  const needSession = async (): Promise<boolean> => {
    if (sessionId) return false
    await api.reply(ev.chatId, 'This chat is not bound yet. Send a message or use /sessions.').catch(() => {})
    return true
  }
  const recentTurns = (): TurnCheckpoint[] =>
    useChangeLedger
      .getState()
      .turns.filter((turn) => turn.sessionId === sessionId)
      .slice(-TURNS_SHOWN)
      .reverse()
  switch (ev.name) {
    case 'sessions': {
      const sessions = recentSessions(project.id).slice(0, SESSIONS_SHOWN)
      if (sessions.length === 0) {
        await api.reply(ev.chatId, 'No chats in this project yet.').catch(() => {})
        return
      }
      const current = sessionByChat.get(ev.chatId)
      const lines = sessions.map((s, i) => `${i + 1}. ${s.title}${s.id === current ? ' ←' : ''}`)
      lines.push('Reply /chat <number> to switch.')
      await api.reply(ev.chatId, lines.join('\n')).catch(() => {})
      return
    }
    case 'chat': {
      const arg = (ev.arg || '').trim()
      if (!/^\d{1,2}$/.test(arg)) {
        const current = project.sessions.find((s) => s.id === sessionByChat.get(ev.chatId))
        const key = current ? 'settings.telegramSection.chatCurrent' : 'settings.telegramSection.chatNone'
        await api.reply(ev.chatId, tx(key, current ? { title: current.title } : undefined)).catch(() => {})
        return
      }
      const picked = recentSessions(project.id)[Number(arg) - 1]
      if (!picked) {
        await api.reply(ev.chatId, 'No chat with that number. Try /sessions.').catch(() => {})
        return
      }
      const bound = await api.bindChat(ev.chatId, project.id, picked.id, ev.userId).catch(() => undefined)
      if (!bound?.ok) return
      sessionByChat.set(ev.chatId, picked.id)
      await api.reply(ev.chatId, `Switched to “${picked.title}”.`).catch(() => {})
      return
    }
    case 'project':
      await api
        .reply(
          ev.chatId,
          `${project.name}
${project.paths.join('\n')}`
        )
        .catch(() => {})
      return
    case 'usage': {
      const db = window.api?.db
      if (!db?.getUsageSummary) {
        await api.reply(ev.chatId, 'Usage data is only available in the desktop app.').catch(() => {})
        return
      }
      const rows = await db.getUsageSummary(Math.floor(Date.now() / 1000) - 86400).catch(() => [])
      let cost = 0
      let calls = 0
      for (const row of rows) {
        cost += Number(row.cost) || 0
        calls += Number(row.calls) || 0
      }
      await api
        .reply(ev.chatId, `Last 24h: ${String(calls)} calls, $${cost.toFixed(2)}.`)
        .catch(() => {})
      return
    }
    case 'plan': {
      // Agent convention: plan = think first, no changes. Switch the session
      // to plan mode, then run the request (or a plan refresh) as a turn.
      if (await needSession()) return
      const request = (ev.arg || '').trim()
      useProviderStore.getState().setAgentMode('plan', sessionId)
      const text = request
        ? `Plan this request with the plan tool before any implementation:

${request}`
        : 'Review this chat and write a task plan for the remaining work with the plan tool. Do not start executing it.'
      enqueue(
        ev.chatId,
        () =>
          runInbound({
            type: 'inbound',
            chatId: ev.chatId,
            userId: ev.userId,
            text,
            projectId: ev.projectId || project.id,
            sessionId: ev.sessionId,
            language: ev.language
          })
      )
      return
    }
    case 'build': {
      if (await needSession()) return
      useProviderStore.getState().setAgentMode('build', sessionId)
      await api.reply(ev.chatId, 'Build mode on. The next message can edit files and run commands.').catch(() => {})
      return
    }
    case 'tasks': {
      if (await needSession()) return
      const plan = usePlanStore.getState()
      if (!plan.hydrated.has(sessionId)) await plan.hydrate(sessionId).catch(() => {})
      const items = (plan.bySession[sessionId] || []).slice(0, 15)
      if (items.length === 0) {
        await api.reply(ev.chatId, 'No task list for this chat yet. Ask the agent to plan the work.').catch(() => {})
        return
      }
      const lines = items.map((it) => `${PLAN_MARK[it.status] || '○'} ${it.content.slice(0, 100)}`)
      const done = items.filter((it) => it.status === 'done' || it.status === 'cancelled').length
      lines.push(`${String(done)}/${String(items.length)} done`)
      await api.reply(ev.chatId, lines.join('\n')).catch(() => {})
      return
    }
    case 'changes': {
      if (await needSession()) return
      const ledger = useChangeLedger.getState()
      if (!ledger.hydrated) await ledger.hydrate().catch(() => {})
      const turns = recentTurns()
      if (turns.length === 0) {
        await api.reply(ev.chatId, 'No file changes recorded for this chat yet.').catch(() => {})
        return
      }
      // The short id token survives new turns landing between /changes and
      // /undo — numbers alone would shift and revert the wrong change set.
      const lines = turns.map((turn, i) => {
        const files = turn.changes.filter((c) => c.status === 'applied').length
        const label = turn.label.replace(/\s+/g, ' ').slice(0, 80)
        return `${i + 1}. ${label} — ${(files === 1 ? `${files} file` : `${files} files`)} [${turn.id.slice(-6)}]`
      })
      lines.push('Reply /undo <number> to revert a change set.')
      await api.reply(ev.chatId, lines.join('\n')).catch(() => {})
      return
    }
    case 'undo': {
      if (await needSession()) return
      const arg = (ev.arg || '').trim()
      if (!/^\d{1,2}$/.test(arg) && !/^[a-z0-9]{3,10}$/i.test(arg)) {
        await api.reply(ev.chatId, 'Reply /undo <number> to revert a change set.').catch(() => {})
        return
      }
      const ledger = useChangeLedger.getState()
      if (!ledger.hydrated) await ledger.hydrate().catch(() => {})
      const turns = recentTurns()
      const turn = /^\d{1,2}$/.test(arg)
        ? turns[Number(arg) - 1]
        : turns.find((candidate) => candidate.id.toLowerCase().endsWith(arg.toLowerCase()))
      if (!turn) {
        await api.reply(ev.chatId, 'No change set with that number. Try /changes.').catch(() => {})
        return
      }
      // Remote default is conservative: later user edits are never clobbered.
      const res = await ledger.revertTurn(turn.id, { skipConflicts: true }).catch(() => null)
      if (!res || !res.ok) {
        await api.reply(ev.chatId, `Revert failed: ${res?.error || 'error'}`).catch(() => {})
        return
      }
      let text = (res.reverted === 1 ? `Reverted ${res.reverted} file.` : `Reverted ${res.reverted} files.`)
      const skipped = (res.conflicts || []).length
      if (skipped > 0) {
        const paths = res
          .conflicts!.slice(0, 3)
          .map((c) => `${c.path} (${c.reason})`)
          .join('\n')
        text += `\n${`Skipped ${res.skipped ?? skipped} (changed afterwards):
${paths}`}`
      }
      await api.reply(ev.chatId, text).catch(() => {})
      return
    }
    case 'model': {
      if (await needSession()) return
      const usage = useUsageStore.getState()
      const route = usage.lastRoute[sessionId]
      const lines = [`Model: ${route?.label || 'Auto'}`]
      const ctx = usage.contextFor(sessionId)
      if (ctx) {
        lines.push(
          `Context: ${String(Math.round(ctx.ratio * 100))}% (${kTokens(ctx.tokens)} / ${kTokens(ctx.window)})`
        )
      }
      await api.reply(ev.chatId, lines.join('\n')).catch(() => {})
      return
    }
    case 'compact': {
      if (await needSession()) return
      if (useChatStore.getState().isSessionStreaming(sessionId)) {
        await api.reply(ev.chatId, 'A turn is still running. Send /stop first.').catch(() => {})
        return
      }
      await api.progress(ev.chatId, 'Compacting context…').catch(() => {})
      const ok = await compactSessionNow(sessionId).catch(() => false)
      await api.reply(ev.chatId, tx(ok ? 'settings.telegramSection.compactDone' : 'settings.telegramSection.compactNothing')).catch(() => {})
      return
    }
  }
}

function handle(ev: TelegramEventDto): void {
  if (!ev || typeof ev !== 'object') return
  if (ev.type === 'pairing') {
    const who = ev.username ? `@${ev.username}` : ev.userId
    try {
      window.dispatchEvent(
        new CustomEvent('pawn:toast', {
          detail: { message: `Telegram pairing ${ev.code} from ${who}` }
        })
      )
    } catch {
      /* ignore */
    }
    return
  }
  if (ev.type === 'permission') {
    if (ev.requestId) usePermissionStore.getState().resolve(ev.requestId, ev.approved === true)
    return
  }
  if (ev.type === 'command' && ev.name === 'stop') {
    if (ev.sessionId) useChatStore.getState().stopStreaming(ev.sessionId)
    else if (CHAT_ID.test(ev.chatId)) {
      const id = sessionByChat.get(ev.chatId)
      if (id) useChatStore.getState().stopStreaming(id)
    }
    return
  }
  if (ev.type === 'command' && ev.name === 'new') {
    sessionByChat.delete(ev.chatId)
    return
  }
  if (ev.type === 'command' && ev.name !== 'new' && ev.name !== 'stop') {
    // Everything except /new and /stop is answered by runDataCommand, so a
    // command added to the main-process gate cannot silently drop here.
    void runDataCommand(ev).catch(() => {})
    return
  }
  if (ev.type === 'inbound' && CHAT_ID.test(ev.chatId) && ev.text && ev.projectId) {
    enqueue(ev.chatId, () => runInbound(ev))
  }
}

let started = false
const forwardedPerms = new Set<string>()

/** Test seam: feed an event through the same path as the telegram:event push. */
export const __handleTelegramEventForTests = handle

/** Subscribe once. Safe to call again; the second call is a no-op. */
export function startTelegramBridge(): void {
  if (started) return
  const api = window.api?.telegram
  if (!api?.onEvent || !api.listen) return
  started = true
  api.onEvent((ev) => handle(ev))
  void api.listen().then((res) => {
    for (const ev of res?.events || []) handle(ev)
  }).catch(() => {})
  void watchResumedTurns()

  usePermissionStore.subscribe((state) => {
    for (const id of forwardedPerms) {
      if (!state.pending.some((p) => p.id === id)) forwardedPerms.delete(id)
    }
    for (const pending of state.pending) {
      if (!pending.sessionId || forwardedPerms.has(pending.id)) continue
      // Every chat bound to the session gets the prompt; the first Allow or
      // Deny anywhere resolves it and the remaining buttons become no-ops.
      const chatIds = chatsForSession(pending.sessionId)
      if (chatIds.length === 0) continue
      forwardedPerms.add(pending.id)
      const summary = [pending.type, pending.description, pending.command, pending.path].filter(Boolean).join('\n')
      for (const chatId of chatIds) {
        void api.askPermission(chatId, pending.id, summary.slice(0, 3000)).catch(() => {})
      }
    }
  })
}
