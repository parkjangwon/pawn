/**
 * `model.request` / `model.response` / `notification` mod events.
 *
 * - `model.request` runs before each main-chat model call. A hook may add
 *   instructions with `next({ ...e, systemAppend: '…' })`; nothing else in the
 *   payload is writable. High risk at consent: it sees the user's last message.
 * - `model.response` runs after each successful call. Observe only.
 * - `notification` runs for every desktop notification Pawn sends. Observe only;
 *   a mod cannot suppress or rewrite one (that would hide permission prompts).
 */
import { getModRuntime } from './runtime'

export const MAX_SYSTEM_APPEND = 8_000
const MAX_TEXT = 20_000

export interface ModelRequestInfo {
  sessionId: string
  round: number
  provider: string
  model: string
  messageCount: number
  lastUserText: string
}

export interface ModelResponseInfo {
  sessionId: string
  round: number
  provider: string
  model: string
  text: string
  toolCalls: string[]
  usage: { inputTokens: number; outputTokens: number }
}

/** Extra system layers from mods (empty when no hook or nothing added). Never throws. */
export async function modModelRequest(info: ModelRequestInfo): Promise<string[]> {
  const rt = getModRuntime()
  if (!rt.hasHooks('model.request')) return []
  const payload = { ...info, lastUserText: info.lastUserText.slice(0, MAX_TEXT) }
  try {
    const out = (await rt.emit('model.request', payload, async (e) => e, undefined, info.sessionId)) as
      | { systemAppend?: unknown }
      | null
      | undefined
    const add = typeof out?.systemAppend === 'string' ? out.systemAppend.trim() : ''
    if (!add) return []
    return [`<mod-instructions>\n${add.slice(0, MAX_SYSTEM_APPEND)}\n</mod-instructions>`]
  } catch {
    return []
  }
}

export function modModelResponse(info: ModelResponseInfo): void {
  const rt = getModRuntime()
  if (!rt.hasHooks('model.response')) return
  const payload = { ...info, text: info.text.slice(0, MAX_TEXT), toolCalls: info.toolCalls.slice(0, 64) }
  void rt.emit('model.response', payload, async (e) => e, undefined, info.sessionId).catch(() => {})
}

export function modNotification(info: { title: string; body: string; source?: string }): void {
  const rt = getModRuntime()
  if (!rt.hasHooks('notification')) return
  const payload = { title: String(info.title || '').slice(0, 200), body: String(info.body || '').slice(0, 2000), source: info.source || 'app' }
  void rt.emit('notification', payload, async (e) => e).catch(() => {})
}
