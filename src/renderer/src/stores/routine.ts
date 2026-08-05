import { create } from 'zustand'
import { useAppStore } from './app'
import { useChatStore } from './chat'
import { uid } from '../utils/uid'
import i18n from '../i18n'

interface RoutineState {
  routines: Routine[]
  /** Routine ids whose task is currently executing. */
  runningIds: Set<string>
  init: () => Promise<void>
  refresh: () => Promise<void>
  add: (input: { name: string; prompt: string; schedule: RoutineSchedule; projectId?: string; sessionId?: string }) => Promise<{ ok?: boolean; error?: string }>
  update: (id: string, patch: Partial<Pick<Routine, 'name' | 'schedule' | 'prompt' | 'projectId' | 'sessionId'>>) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<void>
}

const ROUTINE_IDLE_TIMEOUT = 10 * 60 * 1000
// StrictMode double-mounts effects in dev; the fire listener must register once.
let routineListenerRegistered = false

/** Deliverable: write the finished routine output into ~/.pawn/reports/<name>/. */
async function saveRoutineReport(routine: Routine, result: string): Promise<string | null> {
  try {
    const home = await window.api.fs.homeDir()
    if (typeof home !== 'string' || !home) return null
    const safeName = routine.name.replace(/[^\w가-힣.-]+/g, '_').slice(0, 60) || 'routine'
    const dir = `${home}/.pawn/reports/${safeName}`
    await window.api.fs.mkdir(dir)
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const path = `${dir}/${stamp}.md`
    const body = `# ${routine.name}\n\n- Ran: ${new Date().toISOString()}\n- Schedule: ${routine.schedule}\n\n${result}`
    const write = await window.api.fs.writeFile(path, body)
    return write && write.error ? null : path
  } catch {
    return null
  }
}

/** Ensure the routine has a bound project/session, creating one if needed. */
function ensureRoutineSession(routine: Routine): { projectId: string; sessionId: string } | null {
  const app = useAppStore.getState()

  let projectId = routine.projectId
  if (!projectId || !app.projects.some((p) => p.id === projectId)) {
    let general = app.projects.find((p) => p.id === '__general__')
    if (!general) {
      app.addProject('General', [], '__general__')
      general = useAppStore.getState().projects.find((p) => p.id === '__general__')
    }
    projectId = general?.id || ''
  }
  if (!projectId) return null

  let sessionId = routine.sessionId
  const bound = useAppStore.getState().projects.find((p) => p.id === projectId)?.sessions.some((s) => s.id === sessionId)
  if (!sessionId || !bound) {
    sessionId = app.addSession(projectId, routine.name, { focus: false })
  }
  if (!sessionId) return null
  // Pull the session's stored history into the store so sidebar counts and the
  // chat view are complete before the routine starts appending to it.
  if (!useAppStore.getState().loadedSessions.has(sessionId)) {
    void useAppStore.getState().loadMessages(projectId, sessionId)
  }
  return { projectId, sessionId }
}

async function waitForIdle(timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!useChatStore.getState().isStreaming) return
    await new Promise((r) => setTimeout(r, 500))
  }
}

export async function runRoutine(routine: Routine): Promise<void> {
  const bound = ensureRoutineSession(routine)
  if (!bound) return

  if (routine.projectId !== bound.projectId || routine.sessionId !== bound.sessionId) {
    void window.api.routine?.update(routine.id, {
      projectId: bound.projectId,
      sessionId: bound.sessionId
    })
    useRoutineStore.setState((s) => ({
      routines: s.routines.map((r) =>
        r.id === routine.id ? { ...r, projectId: bound.projectId, sessionId: bound.sessionId } : r
      )
    }))
  }

  useRoutineStore.setState((s) => ({ runningIds: new Set(s.runningIds).add(routine.id) }))
  window.api.notification?.send?.(i18n.t('notifications.routineStarted'), routine.name)?.catch?.(() => {})

  try {
    useChatStore.getState().sendMessage(bound.projectId, bound.sessionId, routine.prompt, 'queue')
    await waitForIdle(ROUTINE_IDLE_TIMEOUT)

    const session = useAppStore.getState().projects
      .find((p) => p.id === bound.projectId)
      ?.sessions.find((s) => s.id === bound.sessionId)
    const lastAssistant = [...(session?.messages || [])].reverse().find((m) => m.role === 'assistant')
    const result = lastAssistant?.content?.trim() || 'Task completed.'
    void window.api.routine?.recordResult?.(routine.id, result.slice(0, 2000))?.catch?.(() => {})
    const reportPath = await saveRoutineReport(routine, result)
    const note = reportPath ? `\nReport: ${reportPath}` : ''
    window.api.notification?.send?.(i18n.t('notifications.routineFinished', { name: routine.name }), (result + note).slice(0, 200))?.catch?.(() => {})
  } finally {
    useRoutineStore.setState((s) => {
      const next = new Set(s.runningIds)
      next.delete(routine.id)
      return { runningIds: next }
    })
  }
}

export const useRoutineStore = create<RoutineState>((set, get) => ({
  routines: [],
  runningIds: new Set(),

  init: async () => {
    if (!routineListenerRegistered) {
      routineListenerRegistered = true
      window.api.routine?.onFire?.((routine) => {
        void runRoutine(routine)
      })
    }
    await get().refresh()
    window.api.headless?.ready?.()
  },

  refresh: async () => {
    try {
      const rows = await window.api.routine?.list()
      if (Array.isArray(rows)) set({ routines: rows })
    } catch { /* desktop-only feature */ }
  },

  add: async (input) => {
    const schedule = JSON.stringify(input.schedule)
    const res = await window.api.routine?.add({
      id: uid('routine-'),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      schedule,
      projectId: input.projectId,
      sessionId: input.sessionId
    })
    await get().refresh()
    return res || { ok: true }
  },

  update: async (id, patch) => {
    const nextPatch: typeof patch = { ...patch }
    if (patch.schedule) nextPatch.schedule = JSON.stringify(patch.schedule)
    await window.api.routine?.update(id, nextPatch)
    await get().refresh()
  },

  toggle: async (id, enabled) => {
    await window.api.routine?.setEnabled(id, enabled)
    await get().refresh()
  },

  remove: async (id) => {
    await window.api.routine?.remove(id)
    await get().refresh()
  },

  runNow: async (id) => {
    const routine = get().routines.find((r) => r.id === id)
    if (routine) await runRoutine(routine)
  }
}))
