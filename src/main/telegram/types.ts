/**
 * Telegram gateway types. The bot token never appears on the public status
 * object that crosses into the renderer.
 */

import type { AppLang } from '../appLanguage'

export interface TelegramAllowUser {
  userId: string
  username?: string
  firstName?: string
  approvedAt: number
  /** Client language at pairing time, so bot copy matches the user. */
  language?: AppLang
}

export interface TelegramPending {
  code: string
  userId: string
  username?: string
  firstName?: string
  chatId: string
  createdAt: number
  /** Last time we told this chat the code. Repeat messages stay quiet for a bit. */
  lastNotifiedAt?: number
  language?: AppLang
}

export interface TelegramChatBinding {
  projectId: string
  sessionId: string
  userId: string
}

export interface TelegramState {
  enabled: boolean
  botToken?: string
  botUsername?: string
  allowFrom: TelegramAllowUser[]
  pending: TelegramPending[]
  chats: Record<string, TelegramChatBinding>
  updateOffset: number
  projectId: string
}

export interface TelegramPublicStatus {
  ok: true
  enabled: boolean
  hasToken: boolean
  username?: string
  projectId: string
  allowFrom: TelegramAllowUser[]
  pending: TelegramPending[]
  polling: boolean
  /** Stable code: token_rejected, conflict, or a short redacted transport error. */
  error?: string
}

export type TelegramEvent =
  | {
      type: 'inbound'
      chatId: string
      userId: string
      username?: string
      text: string
      projectId: string
      sessionId?: string
      /** Paired user's Telegram client language, for renderer copy. */
      language?: AppLang
    }
  | {
      type: 'command'
      name: 'new' | 'stop' | 'sessions' | 'chat' | 'project' | 'usage' | 'plan' | 'build' | 'tasks' | 'changes' | 'undo' | 'model' | 'compact'
      chatId: string
      userId: string
      sessionId?: string
      /** Set for the data commands the renderer answers (e.g. /chat <n>). */
      projectId?: string
      arg?: string
      language?: AppLang
    }
  | { type: 'permission'; requestId: string; approved: boolean }
  | { type: 'pairing'; code: string; userId: string; username?: string; chatId: string }
  | { type: 'status' }

export const EMPTY_TELEGRAM_STATE: TelegramState = {
  enabled: false,
  allowFrom: [],
  pending: [],
  chats: {},
  updateOffset: 0,
  projectId: ''
}
