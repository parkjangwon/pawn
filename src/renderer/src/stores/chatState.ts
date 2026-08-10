import { useAppStore } from './app'
import { usePrefsStore } from './prefs'
import type { ChatState } from './chat'

/** Per-session abort + epoch so concurrent project turns never clobber each other. */
export const sessionControllers = new Map<string, AbortController>()
const sessionEpochs = new Map<string, number>()

/** Refcount of live turns that temporarily forced sleep prevention on. */
let sleepHoldCount = 0
let sleepHoldPrev: 'off' | 'sleep' | 'display' | null = null

export type ChatSet = (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void
export type ChatGet = () => ChatState

export function bumpSessionEpoch(sessionId: string): number {
  const next = (sessionEpochs.get(sessionId) || 0) + 1
  sessionEpochs.set(sessionId, next)
  return next
}

export function getSessionEpoch(sessionId: string): number {
  return sessionEpochs.get(sessionId) || 0
}

export function setSessionStreamingFlags(
  set: ChatSet,
  get: ChatGet,
  sessionId: string,
  streaming: boolean
): void {
  const ids = new Set(get().streamingSessionIds)
  if (streaming) ids.add(sessionId)
  else ids.delete(sessionId)
  const list = Array.from(ids)
  set({
    streamingSessionIds: list,
    isStreaming: list.length > 0,
    streamingSessionId: streaming ? sessionId : list[list.length - 1] || null
  })
  if (window.api.setSessionStreaming) {
    window.api.setSessionStreaming(sessionId, streaming)
  } else {
    window.api.setStreaming?.(list.length > 0)
  }
}

export async function acquireSleepHold(): Promise<void> {
  sleepHoldCount++
  if (sleepHoldCount !== 1) return
  const prefs = usePrefsStore.getState()
  if (prefs.sleepPrevention !== 'off') {
    sleepHoldPrev = null
    return
  }
  sleepHoldPrev = 'off'
  try {
    await window.api.power?.setSleepPrevention?.('sleep')
  } catch {
    sleepHoldPrev = null
  }
}

export function releaseSleepHold(): void {
  if (sleepHoldCount <= 0) return
  sleepHoldCount--
  if (sleepHoldCount > 0 || sleepHoldPrev === null) return
  const restore = sleepHoldPrev
  sleepHoldPrev = null
  void window.api.power?.setSleepPrevention?.(restore).catch(() => {})
}

export function stopSessionController(sessionId: string): void {
  const c = sessionControllers.get(sessionId)
  if (c && !c.signal.aborted) c.abort()
}

export function autoTitle(projectId: string, sessionId: string, content: string): void {
  const session = useAppStore.getState().projects
    .find((p) => p.id === projectId)
    ?.sessions.find((s) => s.id === sessionId)
  if (session && session.messages.length <= 1 && session.title === 'New Session') {
    useAppStore.getState().updateSessionTitle(
      projectId, sessionId,
      content.slice(0, 40) + (content.length > 40 ? '...' : '')
    )
  }
}
