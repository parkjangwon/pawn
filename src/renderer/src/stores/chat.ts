import { create } from 'zustand'
import { useAppStore } from './app'
import { usePermissionStore } from './permission'
import { clearSessionRoute, refreshMeasuredPricing } from '../agent/router'
import {
  displayUserIndex,
  sealTranscriptTail,
  truncateAfterUserIndex,
  truncateBeforeUserIndex
} from '../agent/transcriptTruncate'
import { clearTurnCheckpoint, listRunningTurnCheckpoints } from './turnCheckpoint'
import { buildDisplayContent, stripDisplayImages, type ChatAttachment } from '../utils/attachments'
import {
  autoTitle,
  bumpSessionEpoch,
  sessionControllers,
  setSessionStreamingFlags,
  stopSessionController
} from './chatState'
import { loadTranscript, persistTranscript, systemError } from './chatTranscript'
import { agentLoop, processQueue } from './chatLoop'
import i18n from '../i18n'

// Re-exports so existing import sites keep working after the split.
export {
  demoteVisionPayloadsToText,
  loadTranscript,
  persistTranscript,
  ToolLoopCounter,
  toolCallSignature,
  truncateToolResult
} from './chatTranscript'
export { compactSessionNow } from './chatLoop'

export type SendMode = 'queue' | 'steer'

interface QueueItem {
  projectId: string
  sessionId: string
  content: string
  attachments?: ChatAttachment[]
  /** The bubble is already on screen from when the message was queued. */
  displayed: boolean
}

export interface ChatState {
  isStreaming: boolean
  /** Most recent session that started streaming (status bar / legacy UI). */
  streamingSessionId: string | null
  /** All sessions currently running an agent turn (multi-session). */
  streamingSessionIds: string[]
  /** Flat queue for UI; also keyed per session via sessionQueues. */
  queue: QueueItem[]
  sendMessage: (projectId: string, sessionId: string, content: string, mode: SendMode, attachments?: ChatAttachment[]) => void
  /**
   * Edit a past user message: truncate UI + transcript from that message,
   * then re-run the agent with the new content.
   */
  editAndResend: (
    projectId: string,
    sessionId: string,
    userMessageId: string,
    newContent: string
  ) => Promise<void>
  /** Regenerate the assistant reply for the preceding user turn. */
  regenerate: (projectId: string, sessionId: string, assistantMessageId: string) => Promise<void>
  /** Stop one session, or every session when omitted. */
  stopStreaming: (sessionId?: string) => void
  isSessionStreaming: (sessionId: string) => boolean
  /** After cold start: resume incomplete turns from durable checkpoints. */
  resumeInterruptedTurns: () => Promise<number>
}

export const useChatStore = create<ChatState>((set, get) => ({
  isStreaming: false,
  streamingSessionId: null,
  streamingSessionIds: [],
  queue: [],

  isSessionStreaming: (sessionId) => get().streamingSessionIds.includes(sessionId),

  sendMessage: (projectId, sessionId, content, mode, attachments) => {
    // Refresh measured pricing from recent usage (throttled inside the router)
    // so auto routing tracks real provider rates instead of stale snapshots.
    void refreshMeasuredPricing()

    const sameSessionBusy = get().streamingSessionIds.includes(sessionId)

    // Queue only blocks the *same* session; other sessions run concurrently.
    if (mode === 'queue' && sameSessionBusy) {
      set((s) => ({
        queue: [...s.queue, { projectId, sessionId, content, attachments, displayed: true }]
      }))
      pushUserBubble(projectId, sessionId, content, attachments)
      return
    }

    if (mode === 'steer' && sameSessionBusy) {
      stopSessionController(sessionId)
    }

    pushUserBubble(projectId, sessionId, content, attachments)
    autoTitle(projectId, sessionId, content)

    const epoch = bumpSessionEpoch(sessionId)
    setSessionStreamingFlags(set, get, sessionId, true)
    void agentLoop(projectId, sessionId, content, set, get, attachments, epoch)
  },

  editAndResend: async (projectId, sessionId, userMessageId, newContent) => {
    const text = newContent.trim()
    if (!text) return
    if (get().streamingSessionIds.includes(sessionId)) {
      get().stopStreaming(sessionId)
    }
    const session = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId)
      ?.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const uIdx = displayUserIndex(session.messages, userMessageId)
    if (uIdx < 0) return

    // Preserve vision attachments from the original user transcript entry.
    let attachments: ChatAttachment[] | undefined
    try {
      const entries = await loadTranscript(projectId, sessionId)
      // Find the user entry at this ordinal for attachments before truncating.
      let seen = 0
      for (const e of entries) {
        if (e.role !== 'user') continue
        if (seen === uIdx) {
          if (e.attachments?.length) {
            attachments = e.attachments.map((a, i) => ({
              id: `edit-${i}`,
              name: a.name || 'image',
              kind: 'image' as const,
              dataUrl: a.dataUrl,
              bytes: a.dataUrl?.length || 0
            }))
          }
          break
        }
        seen++
      }
      const kept = sealTranscriptTail(truncateBeforeUserIndex(entries, uIdx))
      persistTranscript(sessionId, kept, '', undefined)
    } catch {
      /* optional */
    }

    useAppStore.getState().truncateMessagesFrom(projectId, sessionId, userMessageId, {
      includeSelf: true
    })
    clearSessionRoute(sessionId)
    get().sendMessage(projectId, sessionId, text, 'steer', attachments)
  },

  regenerate: async (projectId, sessionId, assistantMessageId) => {
    if (get().streamingSessionIds.includes(sessionId)) {
      get().stopStreaming(sessionId)
    }
    const session = useAppStore
      .getState()
      .projects.find((p) => p.id === projectId)
      ?.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const idx = session.messages.findIndex((m) => m.id === assistantMessageId)
    if (idx < 0) return
    let userIdx = -1
    for (let i = idx - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        userIdx = i
        break
      }
    }
    if (userIdx < 0) return
    const userMsg = session.messages[userIdx]
    const userContent = stripDisplayImages(userMsg.content).trim()
    if (!userContent) return
    const uOrdinal = displayUserIndex(session.messages, userMsg.id)
    if (uOrdinal < 0) return

    // Keep transcript through the preceding user entry (attachments + all prior tools).
    let attachments: ChatAttachment[] | undefined
    try {
      const entries = await loadTranscript(projectId, sessionId)
      const kept = sealTranscriptTail(truncateAfterUserIndex(entries, uOrdinal))
      // Drop the trailing user entry — agentLoop will append the user message again
      // via sendMessage; keep prior history only.
      const withoutTailUser =
        kept.length && kept[kept.length - 1].role === 'user' ? kept.slice(0, -1) : kept
      // Preserve attachments from the transcript user entry for vision regenerate.
      const lastUser = kept[kept.length - 1]
      if (lastUser?.role === 'user' && lastUser.attachments?.length) {
        attachments = lastUser.attachments.map((a, i) => ({
          id: `regen-${i}`,
          name: a.name || 'image',
          kind: 'image' as const,
          dataUrl: a.dataUrl,
          bytes: a.dataUrl?.length || 0
        }))
      }
      persistTranscript(sessionId, withoutTailUser, '', undefined)
    } catch {
      /* ignore */
    }

    // Remove from the user bubble onward so sendMessage re-appends a clean user turn.
    useAppStore.getState().truncateMessagesFrom(projectId, sessionId, userMsg.id, {
      includeSelf: true
    })
    clearSessionRoute(sessionId)
    get().sendMessage(projectId, sessionId, userContent, 'steer', attachments)
  },

  stopStreaming: (sessionId) => {
    if (sessionId) {
      bumpSessionEpoch(sessionId)
      stopSessionController(sessionId)
      clearTurnCheckpoint(sessionId, 'aborted')
      // Kill only this session's agent shells (other sessions keep running).
      void window.api.shell?.killSession?.(sessionId)?.catch?.(() => {})
      void window.api.browser?.release?.(sessionId)?.catch?.(() => {})
      setSessionStreamingFlags(set, get, sessionId, false)
      usePermissionStore.getState().denyForSession?.(sessionId)
      if (get().streamingSessionIds.length === 0) {
        void window.api.browser?.hideCursor?.().catch(() => {})
        usePermissionStore.getState().denyAll()
      }
      processQueue(set, get, sessionId)
      return
    }
    // Stop everything.
    for (const id of [...get().streamingSessionIds]) {
      bumpSessionEpoch(id)
      stopSessionController(id)
      clearTurnCheckpoint(id, 'aborted')
      void window.api.shell?.killSession?.(id)?.catch?.(() => {})
    }
    for (const c of sessionControllers.values()) {
      if (!c.signal.aborted) c.abort()
    }
    sessionControllers.clear()
    void window.api.shell?.killAll?.().catch(() => {})
    void window.api.browser?.hideCursor?.().catch(() => {})
    usePermissionStore.getState().denyAll()
    set({ isStreaming: false, streamingSessionId: null, streamingSessionIds: [] })
    window.api.setStreaming?.(false)
    processQueue(set, get)
  },

  resumeInterruptedTurns: async () => {
    const cps = await listRunningTurnCheckpoints()
    if (cps.length === 0) return 0
    let started = 0
    for (const cp of cps) {
      if (get().streamingSessionIds.includes(cp.sessionId)) continue
      // Notify the user once per resumed session.
      systemError(
        cp.projectId,
        cp.sessionId,
        i18n.t('chat.diagnostics.resumedTurn')
      )
      const epoch = bumpSessionEpoch(cp.sessionId)
      setSessionStreamingFlags(set, get, cp.sessionId, true)
      void agentLoop(cp.projectId, cp.sessionId, cp.userContent, set, get, cp.attachments, epoch, cp)
      started++
    }
    return started
  }
}))

function pushUserBubble(projectId: string, sessionId: string, content: string, attachments?: ChatAttachment[]): void {
  useAppStore.getState().addMessage(projectId, sessionId, {
    id: `${Date.now()}-user-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: buildDisplayContent(content, attachments),
    createdAt: Date.now()
  })
}
