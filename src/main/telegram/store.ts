/**
 * ~/.pawn/telegram.json (0600). The bot token is sealed with safeStorage,
 * same as decision.json. The renderer never receives the token.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { decryptApiKey, encryptApiKey } from '../providerSecrets'
import { normalizeLang } from './copy'
import {
  EMPTY_TELEGRAM_STATE,
  type TelegramAllowUser,
  type TelegramChatBinding,
  type TelegramPending,
  type TelegramState
} from './types'

const USER_ID = /^\d{1,20}$/
const CHAT_ID = /^-?\d{1,20}$/
const CODE = /^[A-Z2-9]{8}$/
const ID = /^[\w.-]{1,80}$/

export function telegramConfigPath(dir: string): string {
  return join(dir, 'telegram.json')
}

function clip(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\u0000-\u001f]/g, '').trim()
  return s ? s.slice(0, max) : undefined
}

function asAllow(raw: unknown): TelegramAllowUser | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.userId !== 'string' || !USER_ID.test(o.userId)) return null
  return {
    userId: o.userId,
    username: clip(o.username, 32),
    firstName: clip(o.firstName, 64),
    approvedAt: typeof o.approvedAt === 'number' ? o.approvedAt : 0,
    language: normalizeLang(typeof o.language === 'string' ? o.language : undefined)
  }
}

function asPending(raw: unknown): TelegramPending | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.code !== 'string' || !CODE.test(o.code)) return null
  if (typeof o.userId !== 'string' || !USER_ID.test(o.userId)) return null
  if (typeof o.chatId !== 'string' || !CHAT_ID.test(o.chatId)) return null
  return {
    code: o.code,
    userId: o.userId,
    username: clip(o.username, 32),
    firstName: clip(o.firstName, 64),
    chatId: o.chatId,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
    lastNotifiedAt: typeof o.lastNotifiedAt === 'number' ? o.lastNotifiedAt : undefined,
    language: normalizeLang(typeof o.language === 'string' ? o.language : undefined)
  }
}

function asBinding(raw: unknown): TelegramChatBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.projectId !== 'string' || !ID.test(o.projectId)) return null
  if (typeof o.sessionId !== 'string' || !ID.test(o.sessionId)) return null
  if (typeof o.userId !== 'string' || !USER_ID.test(o.userId)) return null
  return { projectId: o.projectId, sessionId: o.sessionId, userId: o.userId }
}

export function normalizeTelegramState(raw: unknown): TelegramState {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const allowFrom = Array.isArray(o.allowFrom) ? o.allowFrom.map(asAllow).filter((x): x is TelegramAllowUser => !!x) : []
  const pending = Array.isArray(o.pending) ? o.pending.map(asPending).filter((x): x is TelegramPending => !!x) : []
  const chats: Record<string, TelegramChatBinding> = {}
  if (o.chats && typeof o.chats === 'object') {
    for (const [k, v] of Object.entries(o.chats as Record<string, unknown>)) {
      if (!CHAT_ID.test(k)) continue
      const b = asBinding(v)
      if (b) chats[k] = b
    }
  }
  const token = typeof o.botToken === 'string' ? decryptApiKey(o.botToken) : undefined
  const offset = typeof o.updateOffset === 'number' && Number.isFinite(o.updateOffset) ? Math.max(0, Math.floor(o.updateOffset)) : 0
  const projectId = typeof o.projectId === 'string' && (o.projectId === '' || ID.test(o.projectId)) ? o.projectId : ''
  return {
    enabled: o.enabled === true,
    botToken: token || undefined,
    botUsername: clip(o.botUsername, 32),
    allowFrom,
    pending,
    chats,
    updateOffset: offset,
    projectId
  }
}

export interface TelegramStore {
  load: () => TelegramState
  save: (state: TelegramState) => void
}

export function createFileTelegramStore(dir: string): TelegramStore {
  const path = telegramConfigPath(dir)
  return {
    load(): TelegramState {
      if (!existsSync(path)) return { ...EMPTY_TELEGRAM_STATE, allowFrom: [], pending: [], chats: {} }
      try {
        return normalizeTelegramState(JSON.parse(readFileSync(path, 'utf8')))
      } catch {
        return { ...EMPTY_TELEGRAM_STATE, allowFrom: [], pending: [], chats: {} }
      }
    },
    save(state: TelegramState): void {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const sealed: TelegramState = {
        ...state,
        botToken: state.botToken ? encryptApiKey(state.botToken) || undefined : undefined
      }
      writeFileSync(path, JSON.stringify(sealed, null, 2), { encoding: 'utf8', mode: 0o600 })
      try {
        chmodSync(path, 0o600)
      } catch {
        /* Windows */
      }
    }
  }
}
