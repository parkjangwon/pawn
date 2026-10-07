/**
 * Record & Replay state (renderer). Main owns the live recording; this store
 * mirrors its status, runs the setup form, and turns a finished recording
 * into a skill draft in a chat.
 *
 * The finished recording (steps + screenshots) is kept in memory only until
 * a draft succeeds or the user discards it — then it is dropped. It is never
 * persisted anywhere.
 */

import { create } from 'zustand'
import { useAppStore } from './app'
import { useChatStore } from './chat'
import { draftSkillFromRecording } from '../agent/skillDrafting'
import { autoTitle } from './chatState'

export type RecordingSources = { browser: boolean; desktop: boolean }

export interface DraftJob {
  projectId: string
  sessionId: string
  state: 'drafting' | 'failed'
  error?: string
  steps: number
}

interface Target {
  projectId: string
  sessionId: string
}

interface RecordingState {
  /** Host supports Record & Replay (macOS desktop app). */
  supported: boolean
  status: RecordingStatusDto
  readiness: RecorderReadinessDto | null
  setupOpen: boolean
  setupTarget: Partial<Target> | null
  starting: boolean
  error: string | null
  /** Drafting jobs by recording id. */
  jobs: Record<string, DraftJob>
  init: () => void
  openSetup: (target?: Partial<Target>) => void
  closeSetup: () => void
  refreshReadiness: () => Promise<RecorderReadinessDto | null>
  start: (opts: { goal: string; inputsHint: string; sources: RecordingSources }) => Promise<boolean>
  stop: () => Promise<void>
  cancel: () => Promise<void>
  retry: (recordingId: string) => Promise<void>
  discard: (recordingId: string) => void
}

/** Finished recordings waiting for (or retrying) a draft. Memory only. */
const pendingBundles = new Map<string, RecordingBundleDto>()

export function __pendingBundleCount(): number {
  return pendingBundles.size
}

function recorderApi(): NonNullable<typeof window.api.recorder> | null {
  const r = typeof window !== 'undefined' ? window.api?.recorder : undefined
  return r && typeof r.start === 'function' && window.api?.platform === 'darwin' ? r : null
}

function sessionExists(t: Partial<Target> | undefined): t is Target {
  if (!t?.projectId || !t.sessionId) return false
  return !!useAppStore.getState().projects.find((p) => p.id === t.projectId)?.sessions.some((s) => s.id === t.sessionId)
}

/** The chat where the draft goes: the one recording started from, or a fresh one. */
function resolveTarget(bundle: RecordingBundleDto): Target {
  const ctx = bundle.context
  const busy = (id: string): boolean => useChatStore.getState().streamingSessionIds.includes(id)
  if (sessionExists(ctx) && !busy(ctx.sessionId)) return ctx
  const app = useAppStore.getState()
  const projectId =
    (ctx.projectId && app.projects.some((p) => p.id === ctx.projectId) ? ctx.projectId : null) ||
    app.activeProjectId ||
    app.ensureGeneralProject()
  const title = (bundle.goal || 'Recorded workflow').slice(0, 60)
  const sessionId = app.addSession(projectId, title)
  useAppStore.setState((s) => ({ loadedSessions: new Set([...s.loadedSessions, sessionId]) }))
  return { projectId, sessionId }
}

function isStatus(v: unknown): v is RecordingStatusDto {
  return !!v && typeof v === 'object' && ((v as RecordingStatusDto).state === 'idle' || (v as RecordingStatusDto).state === 'recording')
}

let unsubscribe: (() => void) | null = null
let subscribedTo: unknown = null

export const useRecordingStore = create<RecordingState>((set, get) => {
  async function runDraft(bundle: RecordingBundleDto): Promise<void> {
    try {
      await runDraftInner(bundle)
    } catch (err) {
      // Never lose the recording to an unexpected error: keep it for Retry.
      const prev = get().jobs[bundle.id]
      const app = useAppStore.getState()
      set((s) => ({
        jobs: {
          ...s.jobs,
          [bundle.id]: {
            projectId: prev?.projectId || app.activeProjectId || '',
            sessionId: prev?.sessionId || app.activeSessionId || '',
            state: 'failed',
            error: err instanceof Error ? err.message : String(err),
            steps: bundle.steps.length
          }
        }
      }))
    }
  }

  async function runDraftInner(bundle: RecordingBundleDto): Promise<void> {
    const prev = get().jobs[bundle.id]
    const target = prev && sessionExists(prev) ? { projectId: prev.projectId, sessionId: prev.sessionId } : resolveTarget(bundle)
    // Messages must be in memory before new ones are appended (lazy load).
    await useAppStore.getState().loadMessages(target.projectId, target.sessionId).catch(() => {})
    const app = useAppStore.getState()
    if (app.activeProjectId !== target.projectId || app.activeSessionId !== target.sessionId) {
      app.setActiveProject(target.projectId)
      app.setActiveSession(target.sessionId)
    }
    set((s) => ({ jobs: { ...s.jobs, [bundle.id]: { ...target, state: 'drafting', steps: bundle.steps.length } } }))
    const session = useAppStore.getState().projects.find((p) => p.id === target.projectId)?.sessions.find((x) => x.id === target.sessionId)
    if (session && session.messages.length === 0 && bundle.goal) autoTitle(target.projectId, target.sessionId, bundle.goal)
    const outcome = await draftSkillFromRecording(bundle, target)
    if (outcome.ok) {
      // Drafted: the recording is no longer needed anywhere.
      pendingBundles.delete(bundle.id)
      set((s) => {
        const jobs = { ...s.jobs }
        delete jobs[bundle.id]
        return { jobs }
      })
      if (!outcome.draft) {
        window.dispatchEvent(new CustomEvent('pawn:toast', { detail: { message: 'The answer has no SKILL.md block. Ask the agent to write it as a skill.' } }))
      }
      return
    }
    set((s) => ({ jobs: { ...s.jobs, [bundle.id]: { ...target, state: 'failed', error: outcome.error, steps: bundle.steps.length } } }))
  }

  function onEvent(ev: RecorderEventDto): void {
    switch (ev.type) {
      case 'started':
      case 'progress':
        if (isStatus(ev.status)) set({ status: ev.status, error: null })
        break
      case 'cancelled':
        set({ status: { state: 'idle' } })
        break
      case 'error':
        set({ error: ev.error })
        break
      case 'open-setup':
        get().openSetup()
        break
      case 'finished': {
        set({ status: { state: 'idle' } })
        const bundle = ev.bundle
        if (!bundle || !Array.isArray(bundle.steps)) return
        if (bundle.steps.length === 0) {
          set({ error: 'Nothing was recorded. Do the task while recording, then stop.' })
          return
        }
        pendingBundles.set(bundle.id, bundle)
        void runDraft(bundle)
        break
      }
    }
  }

  return {
    supported: false,
    status: { state: 'idle' },
    readiness: null,
    setupOpen: false,
    setupTarget: null,
    starting: false,
    error: null,
    jobs: {},

    init: () => {
      const api = recorderApi()
      set({ supported: !!api })
      if (!api || subscribedTo === api) return
      unsubscribe?.()
      unsubscribe = api.onEvent(onEvent)
      subscribedTo = api
      void api
        .status()
        .then((s) => {
          if (isStatus(s)) set({ status: s })
        })
        .catch(() => {})
    },

    openSetup: (target) => {
      if (!recorderApi()) return
      if (get().status.state === 'recording') return
      const app = useAppStore.getState()
      set({
        setupOpen: true,
        error: null,
        setupTarget: target ?? { projectId: app.activeProjectId ?? undefined, sessionId: app.activeSessionId ?? undefined }
      })
      void get().refreshReadiness()
    },

    closeSetup: () => set({ setupOpen: false, error: null }),

    refreshReadiness: async () => {
      const api = recorderApi()
      if (!api) return null
      try {
        const r = await api.readiness()
        set({ readiness: r })
        return r
      } catch {
        return null
      }
    },

    start: async ({ goal, inputsHint, sources }) => {
      const api = recorderApi()
      if (!api) return false
      const list: RecordingSourceDto[] = []
      if (sources.browser) list.push('browser')
      if (sources.desktop) list.push('desktop')
      set({ starting: true, error: null })
      try {
        const target = get().setupTarget
        const r = await api.start({
          goal: goal.trim(),
          inputsHint: inputsHint.trim(),
          sources: list,
          context: target ? { projectId: target.projectId, sessionId: target.sessionId } : undefined
        })
        if (!r.ok) {
          set({ error: r.error })
          return false
        }
        set({ status: r.status, setupOpen: false })
        if (list.includes('browser')) {
          try {
            ;(window as unknown as { __openRightPanelTab?: (t: string) => void }).__openRightPanelTab?.('browser')
          } catch {
            /* panel optional */
          }
        }
        return true
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
        return false
      } finally {
        set({ starting: false })
      }
    },

    stop: async () => {
      const api = recorderApi()
      if (!api) return
      const r = await api.stop().catch((err: unknown) => ({ ok: false, error: String(err) }))
      if (!r.ok && r.error) set({ error: r.error })
    },

    cancel: async () => {
      await recorderApi()?.cancel().catch(() => {})
      set({ status: { state: 'idle' } })
    },

    retry: async (id) => {
      const bundle = pendingBundles.get(id)
      if (!bundle) return
      await runDraft(bundle)
    },

    discard: (id) => {
      pendingBundles.delete(id)
      set((s) => {
        const jobs = { ...s.jobs }
        delete jobs[id]
        return { jobs }
      })
    }
  }
})
