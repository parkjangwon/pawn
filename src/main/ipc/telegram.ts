import { handleTrusted } from './trust'
import { getPawnDir } from '../config'
import { getMainWindow } from '../window'
import { createTelegramService, type TelegramService } from '../telegram/service'
import type { TelegramEvent } from '../telegram/types'

let service: TelegramService | null = null
let listening = false
const queue: TelegramEvent[] = []

function push(event: TelegramEvent): void {
  const win = getMainWindow()
  if (listening && win && !win.isDestroyed()) {
    win.webContents.send('telegram:event', event)
    return
  }
  queue.push(event)
  if (queue.length > 100) queue.shift()
}

export function getTelegramService(): TelegramService {
  if (!service) service = createTelegramService({ dir: getPawnDir(), notify: push })
  return service
}

/** Telegram long-poll gateway. The bot token stays in the main process. */
export function registerTelegramIpc(): void {
  const svc = getTelegramService()

  handleTrusted('telegram:status', () => svc.status())
  handleTrusted('telegram:bindings', () => svc.bindings())
  handleTrusted('telegram:setEnabled', (_e, enabled: unknown) => svc.setEnabled(enabled === true))
  handleTrusted('telegram:setToken', (_e, token: unknown) => svc.setToken(token))
  handleTrusted('telegram:clearToken', () => svc.clearToken())
  handleTrusted('telegram:setProject', (_e, projectId: unknown) => svc.setProject(projectId))
  handleTrusted('telegram:approve', (_e, code: unknown) => svc.approve(code))
  handleTrusted('telegram:deny', (_e, code: unknown) => svc.deny(code))
  handleTrusted('telegram:revoke', (_e, userId: unknown) => svc.revoke(userId))
  handleTrusted('telegram:allowUser', (_e, userId: unknown) => svc.allowUser(userId))
  handleTrusted('telegram:bindChat', (_e, chatId: unknown, projectId: unknown, sessionId: unknown, userId: unknown) =>
    svc.bindChat(chatId, projectId, sessionId, userId)
  )
  handleTrusted('telegram:reply', (_e, chatId: unknown, text: unknown) => svc.reply(chatId, text))
  handleTrusted('telegram:progress', (_e, chatId: unknown, text: unknown) => svc.progress(chatId, text))
  handleTrusted('telegram:askPermission', (_e, chatId: unknown, requestId: unknown, summary: unknown) =>
    svc.askPermission(chatId, requestId, summary)
  )
  handleTrusted('telegram:listen', () => {
    listening = true
    return { ok: true as const, events: queue.splice(0, queue.length) }
  })

  const current = svc.status()
  if (current.enabled && current.hasToken) void svc.start()
}

export async function disposeTelegram(): Promise<void> {
  listening = false
  await service?.stop().catch(() => {})
}
