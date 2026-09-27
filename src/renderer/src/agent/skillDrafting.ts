/**
 * Record & Replay drafting: turn a finished recording into a SKILL.md draft
 * inside a chat. The recording's steps and screenshots are sent to the chat
 * model once (no tools), the answer streams into an assistant message, and
 * the chat's transcript keeps only a short note plus the draft — the raw
 * recording itself is never stored.
 */

import i18n from '../i18n'
import { useAppStore } from '../stores/app'
import { useChatStore } from '../stores/chat'
import { processQueue } from '../stores/chatLoop'
import { sessionControllers, setSessionStreamingFlags, type ChatGet, type ChatSet } from '../stores/chatState'
import { loadTranscript, persistTranscript } from '../stores/chatTranscript'
import { useUsageStore } from '../stores/usage'
import { callLLM } from './llm'
import { noteProviderFailure, noteProviderSuccess, route, type RouteDecision } from './router'
import type { TranscriptEntry } from './transcript'
import { buildDraftSystemPrompt, buildDraftUserText, extractSkillDraft, type SkillDraft } from './recordReplay'

export type DraftOutcome =
  | { ok: true; draft: SkillDraft | null; messageId: string }
  | { ok: false; error: string; aborted?: boolean }

const MAX_ATTEMPTS = 2

function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Short visible note for the user bubble (no step list, no screenshots). */
export function recordingNote(bundle: RecordingBundleDto): string {
  return i18n.t('record.chat.recorded', {
    goal: bundle.goal || i18n.t('record.chat.noGoal'),
    steps: bundle.steps.length,
    duration: formatDuration(bundle.durationMs)
  })
}

/** What the chat remembers about the recording (the draft follows it). */
export function transcriptNote(note: string): string {
  return (
    `${note}\n[Record & Replay: the user demonstrated this workflow; the recording and its screenshots were deleted after drafting. ` +
    'The SKILL.md draft in the next message is the only record of it. When asked to change it, reply with the full revised SKILL.md in a ````skill block and save it with save_skill.]'
  )
}

const chatSet = useChatStore.setState as unknown as ChatSet
const chatGet = useChatStore.getState as unknown as ChatGet

export async function draftSkillFromRecording(
  bundle: RecordingBundleDto,
  target: { projectId: string; sessionId: string }
): Promise<DraftOutcome> {
  const { projectId, sessionId } = target
  const controller = new AbortController()
  sessionControllers.set(sessionId, controller)
  setSessionStreamingFlags(chatSet, chatGet, sessionId, true)
  const noteId = `${Date.now()}-rec-user`
  let messageId = ''
  try {
    // Read the chat's history before adding bubbles: a chat without a stored
    // transcript is rebuilt from its visible messages.
    const prior: TranscriptEntry[] = await loadTranscript(projectId, sessionId).catch(() => [])
    const note = recordingNote(bundle)
    useAppStore.getState().addMessage(projectId, sessionId, { id: noteId, role: 'user', content: note, createdAt: Date.now() })

    const images = bundle.frames.map((f) => ({ kind: 'image' as const, dataUrl: f.dataUrl, name: `after step ${f.step}` }))
    const text = buildDraftUserText(bundle)
    let entries: TranscriptEntry[] = [{ role: 'user', content: text, ...(images.length ? { attachments: images } : {}) }]
    const system = [buildDraftSystemPrompt(i18n.language)]
    // Own sticky key: drafting must not move the chat's warm model.
    const routeId = `rec:${bundle.id}`
    let lastError = ''
    const excluded = new Set<string>()

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const withImages = entries.some((e) => e.role === 'user' && !!e.attachments?.length)
      let decision: RouteDecision | null = route({ sessionId: routeId, entries, complexity: 'complex', needsVision: withImages, exclude: excluded, newTurn: true })
      if (!decision && withImages) {
        // No model can see images: draft from the step list alone.
        entries = [{ role: 'user', content: `${text}\n\n(Screenshots were captured but no configured model accepts images; work from the steps.)` }]
        decision = route({ sessionId: routeId, entries, complexity: 'complex', exclude: excluded, newTurn: true })
      }
      if (!decision) {
        lastError = i18n.t('chat.errors.noProvider')
        break
      }
      messageId = `${Date.now()}-rec-draft-${attempt}`
      useAppStore.getState().addMessage(projectId, sessionId, { id: messageId, role: 'assistant', content: '', createdAt: Date.now() })
      try {
        const result = await callLLM({
          decision,
          entries,
          systemLayers: system,
          projectPreamble: '',
          sessionId,
          projectId,
          assistantMsgId: messageId,
          signal: controller.signal,
          complexity: 'complex',
          noTools: true
        })
        noteProviderSuccess(decision.provider.id)
        useUsageStore.getState().record(sessionId, decision.model, result.usage)
        const answer = result.text.trim()
        if (!answer) throw Object.assign(new Error(i18n.t('record.errors.emptyDraft')), { transient: true })
        const app = useAppStore.getState()
        app.updateMessageContent(projectId, sessionId, messageId, answer, true)
        app.updateMessageModel(projectId, sessionId, messageId, decision.model.label || decision.model.modelId)
        // The chat keeps a note and the draft, never the recording.
        persistTranscript(sessionId, [...prior, { role: 'user', content: transcriptNote(note) }, { role: 'assistant', content: answer }], '')
        return { ok: true, draft: extractSkillDraft(answer), messageId }
      } catch (err) {
        useAppStore.getState().removeMessage(projectId, sessionId, messageId)
        messageId = ''
        if (controller.signal.aborted) {
          useAppStore.getState().removeMessage(projectId, sessionId, noteId)
          return { ok: false, error: i18n.t('record.errors.cancelled'), aborted: true }
        }
        lastError = err instanceof Error ? err.message : String(err)
        if ((err as { transient?: boolean }).transient !== false) noteProviderFailure(decision.provider.id)
        excluded.add(decision.key)
      }
    }
    // A retry adds its own note again.
    useAppStore.getState().removeMessage(projectId, sessionId, noteId)
    return { ok: false, error: lastError || i18n.t('record.errors.draftFailed') }
  } finally {
    if (sessionControllers.get(sessionId) === controller) sessionControllers.delete(sessionId)
    setSessionStreamingFlags(chatSet, chatGet, sessionId, false)
    processQueue(chatSet, chatGet, sessionId)
  }
}
