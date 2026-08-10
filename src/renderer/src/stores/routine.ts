import { create } from 'zustand'
import { useAppStore } from './app'
import { useChatStore } from './chat'
import { useArtifactsStore, openArtifactsPanel } from './artifacts'
import { uid } from '../utils/uid'
import i18n from '../i18n'

interface RoutineState {
  routines: Routine[]
  /** Routine ids whose task is currently executing. */
  runningIds: Set<string>
  init: () => Promise<void>
  refresh: () => Promise<void>
  add: (input: { name: string; prompt: string; schedule: RoutineSchedule; projectId?: string; sessionId?: string }) => Promise<{ ok?: boolean; error?: string }>
  update: (
    id: string,
    patch: Partial<{
      name: string
      /** Object schedule (stringified) or already-serialized JSON string. */
      schedule: RoutineSchedule | string
      prompt: string
      projectId: string
      sessionId: string
    }>
  ) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<void>
}

const ROUTINE_IDLE_TIMEOUT = 10 * 60 * 1000
// StrictMode double-mounts effects in dev; the fire listener must register once.
let routineListenerRegistered = false

/** Deliverable: write finished automation output to ~/.pawn/reports/<name>/. */
async function saveAutomationReport(routine: Routine, result: string): Promise<string | null> {
  try {
    const home = await window.api.fs.homeDir()
    if (typeof home !== 'string' || !home) return null
    const safeName = routine.name.replace(/[^\w가-힣.-]+/g, '_').slice(0, 60) || 'automation'
    const dir = `${home}/.pawn/reports/${safeName}`
    await window.api.fs.mkdir(dir)
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const path = `${dir}/${stamp}.md`
    const body = `# ${routine.name}\n\n- Ran: ${new Date().toISOString()}\n- Schedule: ${routine.schedule}\n\n${result}`
    const write = await window.api.fs.writeFile(path, body)
    if (write && write.error) return null
    useArtifactsStore.getState().add({
      title: routine.name,
      kind: 'report',
      path,
      preview: result.slice(0, 1500),
      source: i18n.t('rightPanel.artifacts.sources.automation')
    })
    openArtifactsPanel()
    return path
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

/** Wait until chat is idle. Returns false if still streaming after timeout. */
async function waitForIdle(timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!useChatStore.getState().isStreaming) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return !useChatStore.getState().isStreaming
}

function parsePolicyFromSchedule(scheduleJson: string): {
  maxRetries: number
  retryDelaySec: number
  steps: string[]
  dependsOn: string[]
  skipIfRunning: boolean
} {
  try {
    const s = JSON.parse(scheduleJson) as Record<string, unknown>
    return {
      maxRetries: Math.min(5, Math.max(0, Math.floor(Number(s.maxRetries) || 0))),
      retryDelaySec: Math.min(3600, Math.max(10, Math.floor(Number(s.retryDelaySec) || 60))),
      steps: Array.isArray(s.steps)
        ? s.steps.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 20)
        : [],
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String).filter(Boolean) : [],
      skipIfRunning: s.skipIfRunning === true
    }
  } catch {
    return { maxRetries: 0, retryDelaySec: 60, steps: [], dependsOn: [], skipIfRunning: false }
  }
}

export async function runRoutine(routine: Routine): Promise<void> {
  const bound = ensureRoutineSession(routine)
  if (!bound) return

  const policy = parsePolicyFromSchedule(routine.schedule)

  if (policy.skipIfRunning && useRoutineStore.getState().runningIds.has(routine.id)) {
    return
  }

  // Dependency gate: required routines must not have lastResult starting with FAIL
  if (policy.dependsOn.length) {
    const all = useRoutineStore.getState().routines
    for (const depId of policy.dependsOn) {
      const dep = all.find((r) => r.id === depId || r.name === depId)
      if (!dep) continue
      const lr = (dep.lastResult || '').trim()
      if (/^FAIL\b/i.test(lr) || lr.startsWith('error:')) {
        const msg = `FAIL: dependency ${dep.name || depId} not successful`
        void window.api.routine?.recordResult?.(routine.id, msg)?.catch?.(() => {})
        return
      }
    }
  }

  if (routine.projectId !== bound.projectId || routine.sessionId !== bound.sessionId) {
    void window.api.routine?.update(routine.id, {
      projectId: bound.projectId,
      sessionId: bound.sessionId
    })?.catch?.(() => {})
    useRoutineStore.setState((s) => ({
      routines: s.routines.map((r) =>
        r.id === routine.id ? { ...r, projectId: bound.projectId, sessionId: bound.sessionId } : r
      )
    }))
  }

  useRoutineStore.setState((s) => ({ runningIds: new Set(s.runningIds).add(routine.id) }))
  window.api.notification?.send?.(i18n.t('notifications.automationStarted'), routine.name)?.catch?.(() => {})

  const prompts =
    policy.steps.length > 0 ? policy.steps : [routine.prompt]

  try {
    let attempt = 0
    let result = ''
    let failed = false

    while (attempt <= policy.maxRetries) {
      failed = false
      const parts: string[] = []
      for (let i = 0; i < prompts.length; i++) {
        const stepPrompt =
          prompts.length > 1
            ? `[Automation step ${i + 1}/${prompts.length}]\n${prompts[i]}`
            : prompts[i]
        useChatStore.getState().sendMessage(bound.projectId, bound.sessionId, stepPrompt, 'queue')
        const idle = await waitForIdle(ROUTINE_IDLE_TIMEOUT)
        if (!idle) {
          // Bound hang: stop the stuck turn so later steps / retries can proceed.
          useChatStore.getState().stopStreaming()
          await waitForIdle(15_000)
          parts.push(`FAIL: automation step timed out after ${ROUTINE_IDLE_TIMEOUT / 60000} minutes`)
          failed = true
          break
        }
        const session = useAppStore.getState().projects
          .find((p) => p.id === bound.projectId)
          ?.sessions.find((s) => s.id === bound.sessionId)
        const lastAssistant = [...(session?.messages || [])]
          .reverse()
          .find((m) => m.role === 'assistant')
        const stepResult = lastAssistant?.content?.trim() || 'Task completed.'
        parts.push(stepResult)
        if (/^FAIL\b/i.test(stepResult) || /\[auto_verify[^\]]*\][\s\S]*\bFAIL\b/i.test(stepResult)) {
          failed = true
          break
        }
      }
      result = parts.join('\n\n---\n\n') || 'Task completed.'
      if (!failed) break
      attempt++
      if (attempt <= policy.maxRetries) {
        await new Promise((r) => setTimeout(r, policy.retryDelaySec * 1000))
      }
    }

    if (failed) result = `FAIL (after ${attempt} attempts)\n\n${result}`

    void window.api.routine?.recordResult?.(routine.id, result.slice(0, 2000))?.catch?.(() => {})
    const reportPath = await saveAutomationReport(routine, result)
    const note = reportPath ? `\nReport: ${reportPath}` : ''
    window.api.notification?.send?.(i18n.t('notifications.automationFinished', { name: routine.name }), (result + note).slice(0, 200))?.catch?.(() => {})
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
    const nextPatch: {
      name?: string
      schedule?: string
      prompt?: string
      projectId?: string
      sessionId?: string
    } = {}
    if (patch.name !== undefined) nextPatch.name = patch.name
    if (patch.prompt !== undefined) nextPatch.prompt = patch.prompt
    if (patch.projectId !== undefined) nextPatch.projectId = patch.projectId
    if (patch.sessionId !== undefined) nextPatch.sessionId = patch.sessionId
    if (patch.schedule !== undefined) {
      nextPatch.schedule =
        typeof patch.schedule === 'string' ? patch.schedule : JSON.stringify(patch.schedule)
    }
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

/** Preferred public name — DB/IPC stay `routine` for compatibility. */
export const useAutomationStore = useRoutineStore
