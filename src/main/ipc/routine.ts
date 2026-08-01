import { ipcMain, powerSaveBlocker } from 'electron'
import { handleTrusted } from './trust'
import { getMainWindow } from '../window'
import * as db from '../db'
import { loadConfig } from '../config'
import { computeNextRun, MAX_TIMEOUT_MS, parseSchedule } from '../routineSchedule'

const timers = new Map<string, NodeJS.Timeout>()
let powerBlockerId: number | null = null

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

function armTimer(row: db.RoutineRow): void {
  clearTimer(row.id)
  if (!row.enabled) return
  const schedule = parseSchedule(row.schedule)
  if (!schedule) return

  const fire = (): void => {
    clearTimer(row.id)
    const next = computeNextRun(schedule)
    db.setRoutineRunState(row.id, next, Date.now(), '')

    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('routine:fire', { ...row, nextRunAt: next, lastRunAt: Date.now() })
    }
    // Re-arm from the DB so edits made since this timer was scheduled win.
    const fresh = db.getAllRoutines().find((r) => r.id === row.id)
    if (fresh) armTimer(fresh)
  }

  const delay = Math.max(0, row.nextRunAt - Date.now())
  timers.set(row.id, setTimeout(fire, Math.min(delay, MAX_TIMEOUT_MS)))
}

function scheduleAll(): void {
  const now = Date.now()
  for (const row of db.getAllRoutines()) {
    if (!row.enabled) continue
    // Skip runs missed while the app was closed; advance to the next occurrence.
    if (row.nextRunAt <= now) {
      const schedule = parseSchedule(row.schedule)
      if (!schedule) continue
      const next = computeNextRun(schedule, now)
      db.updateRoutine(row.id, { nextRunAt: next })
      armTimer({ ...row, nextRunAt: next })
    } else {
      armTimer(row)
    }
  }
}

function applySleepPrevention(mode: string): void {
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId)
    powerBlockerId = null
  }
  if (mode === 'sleep') {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (mode === 'display') {
    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
  }
}

export function registerRoutineIpc(): void {
  handleTrusted('routine:list', async () => db.getAllRoutines())

  handleTrusted('routine:add', async (_, input: {
    id: string
    name: string
    schedule: string
    prompt: string
    projectId?: string
    sessionId?: string
  }) => {
    const schedule = parseSchedule(input.schedule)
    if (!schedule || !input.name.trim() || !input.prompt.trim()) {
      return { error: 'Invalid routine' }
    }
    const nextRunAt = computeNextRun(schedule)
    const row: db.RoutineRow = {
      id: input.id,
      name: input.name.trim(),
      schedule: input.schedule,
      prompt: input.prompt.trim(),
      projectId: input.projectId || '',
      sessionId: input.sessionId || '',
      enabled: true,
      nextRunAt,
      lastRunAt: 0,
      lastResult: '',
      createdAt: Date.now()
    }
    db.addRoutine(row)
    armTimer(row)
    return { ok: true, routine: row }
  })

  handleTrusted('routine:update', async (_, id: string, patch: {
    name?: string
    schedule?: string
    prompt?: string
    projectId?: string
    sessionId?: string
  }) => {
    db.updateRoutine(id, patch)
    const row = db.getAllRoutines().find((r) => r.id === id)
    if (row) armTimer(row)
    return { ok: true }
  })

  handleTrusted('routine:setEnabled', async (_, id: string, enabled: boolean) => {
    db.updateRoutine(id, { enabled })
    const row = db.getAllRoutines().find((r) => r.id === id)
    if (row) armTimer(row)
    return { ok: true }
  })

  handleTrusted('routine:remove', async (_, id: string) => {
    clearTimer(id)
    db.removeRoutine(id)
    return { ok: true }
  })

  handleTrusted('routine:recordResult', async (_, id: string, result: string) => {
    const row = db.getAllRoutines().find((r) => r.id === id)
    if (!row) return { ok: true }
    const schedule = parseSchedule(row.schedule)
    const next = schedule ? computeNextRun(schedule) : row.nextRunAt
    db.setRoutineRunState(id, next, Date.now(), (result || '').slice(0, 2000))
    return { ok: true }
  })

  handleTrusted('power:setSleepPrevention', async (_, mode: string) => {
    if (mode !== 'off' && mode !== 'sleep' && mode !== 'display') mode = 'off'
    applySleepPrevention(mode)
    return { ok: true }
  })
}

/** Called after app ready: restore routine timers and the saved sleep setting. */
export function startRoutineServices(): void {
  scheduleAll()
  try {
    const cfg = loadConfig() as { settings?: { sleepPrevention?: string } }
    applySleepPrevention(cfg.settings?.sleepPrevention || 'off')
  } catch {
    // Missing or corrupt config — leave the system sleep policy untouched.
  }
}

export function stopRoutineServices(): void {
  timers.forEach((_timer, id) => clearTimer(id))
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId)
    powerBlockerId = null
  }
}
