/**
 * Recording session (main process). Collects events from the enabled
 * sources (Pawn's browser, Mac apps via the native helper), grabs a
 * screenshot after meaningful steps, and on stop hands one bundle to the
 * renderer for drafting — then forgets everything. Nothing is written to disk.
 *
 * No electron imports: sources are injected adapters (testable in Node).
 */

import { randomBytes } from 'crypto'
import {
  buildSteps,
  normalizeEvents,
  pickKeyframes,
  sanitizeEvent,
  stepText,
  thinFrames,
  formatSteps
} from './timeline'
import {
  RECORDER_LIMITS,
  type RecEvent,
  type RecFrame,
  type RecorderEvent,
  type RecordingBundle,
  type RecordingContext,
  type RecordingSource,
  type RecordingStatus,
  type StopReason
} from './types'

export type FrameGrab = { dataUrl: string; width: number; height: number } | null

export interface RecorderSourceAdapter {
  /** Returns an error when the source can't record right now. */
  start(onEvent: (raw: unknown) => void): Promise<{ ok: boolean; error?: string; notes?: string[] }>
  stop(): Promise<void>
  capture(): Promise<FrameGrab>
}

export interface RecorderDeps {
  sources: Partial<Record<RecordingSource, RecorderSourceAdapter>>
  emit: (event: RecorderEvent) => void
  platform?: string
  now?: () => number
  /** Timer hooks (tests). */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** Wait for sources to flush after stop (ms). */
  settleMs?: number
}

export interface StartRequest {
  context?: unknown
  goal?: unknown
  inputsHint?: unknown
  sources?: unknown
}

/** Steps after which the screen is worth a picture. */
const FRAME_KINDS = new Set(['navigate', 'click', 'submit', 'app', 'tab', 'select', 'key'])
const FRAME_DELAY_MS = 700
const FRAME_MIN_GAP_MS = 1200
const PROGRESS_THROTTLE_MS = 250

interface Session {
  id: string
  context: RecordingContext
  goal: string
  inputsHint: string
  sources: RecordingSource[]
  startedAt: number
  events: RecEvent[]
  frames: RecFrame[]
  framesCaptured: number
  notes: string[]
  lastFrameAt: number
  frameTimer: unknown
  pendingFrameSource: RecordingSource | null
  limitTimer: unknown
  progressTimer: unknown
  /** No new events accepted. */
  stopping: boolean
  /** stop() is running (sources may still flush). */
  finishing: boolean
}

export type RecorderService = ReturnType<typeof createRecorderService>

function parseContext(raw: unknown): RecordingContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = (v: unknown): string | undefined => (typeof v === 'string' && /^[\w.:-]{1,120}$/.test(v) ? v : undefined)
  const out: RecordingContext = {}
  const p = id(o.projectId)
  const s = id(o.sessionId)
  if (p) out.projectId = p
  if (s) out.sessionId = s
  return out
}

export function createRecorderService(deps: RecorderDeps) {
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const platform = deps.platform ?? process.platform
  const settleMs = deps.settleMs ?? 150
  let session: Session | null = null

  const elapsed = (s: Session): number => Math.max(0, now() - s.startedAt)

  function status(): RecordingStatus {
    const s = session
    if (!s) return { state: 'idle' }
    const steps = normalizeEvents(s.events)
    const last = steps[steps.length - 1]
    return {
      state: 'recording',
      id: s.id,
      context: s.context,
      goal: s.goal,
      sources: s.sources,
      startedAt: s.startedAt,
      elapsedMs: elapsed(s),
      steps: steps.length,
      lastStep: last ? stepText(last) : undefined,
      notes: s.notes
    }
  }

  function scheduleProgress(): void {
    const s = session
    if (!s || s.progressTimer) return
    s.progressTimer = setTimer(() => {
      if (!session || session !== s) return
      s.progressTimer = null
      deps.emit({ type: 'progress', status: status() })
    }, PROGRESS_THROTTLE_MS)
  }

  async function grabFrame(s: Session, source: RecordingSource): Promise<void> {
    const adapter = deps.sources[source]
    if (!adapter) return
    let shot: FrameGrab = null
    try {
      shot = await adapter.capture()
    } catch {
      shot = null
    }
    if (!shot || session !== s || !shot.dataUrl.startsWith('data:image/')) return
    s.lastFrameAt = now()
    s.framesCaptured++
    s.frames.push({ t: elapsed(s), source, dataUrl: shot.dataUrl, width: shot.width, height: shot.height })
    s.frames = thinFrames(s.frames, RECORDER_LIMITS.maxFramesKept)
  }

  function scheduleFrame(s: Session, source: RecordingSource): void {
    s.pendingFrameSource = source
    if (s.frameTimer) clearTimer(s.frameTimer)
    const wait = Math.max(FRAME_DELAY_MS, FRAME_MIN_GAP_MS - (now() - s.lastFrameAt))
    s.frameTimer = setTimer(() => {
      s.frameTimer = null
      const src = s.pendingFrameSource
      s.pendingFrameSource = null
      if (src && session === s && !s.stopping) void grabFrame(s, src)
    }, wait)
  }

  function onRaw(s: Session, source: RecordingSource, raw: unknown): void {
    if (session !== s || s.stopping) return
    const ev = sanitizeEvent(raw, source, elapsed(s))
    if (!ev) return
    s.events.push(ev)
    if (s.events.length >= RECORDER_LIMITS.maxEvents) {
      s.notes.push(`Recording stopped at the ${RECORDER_LIMITS.maxEvents}-event limit.`)
      void stop('event_limit')
      return
    }
    if (FRAME_KINDS.has(ev.kind)) scheduleFrame(s, source)
    scheduleProgress()
  }

  function parseSources(raw: unknown): RecordingSource[] {
    const list = Array.isArray(raw) ? raw : ['browser', 'desktop']
    const out = list.filter((x): x is RecordingSource => x === 'browser' || x === 'desktop')
    return Array.from(new Set(out))
  }

  async function start(req: StartRequest = {}): Promise<{ ok: true; status: RecordingStatus } | { ok: false; error: string }> {
    if (platform !== 'darwin') return { ok: false, error: 'Record & Replay is available on macOS only.' }
    if (session) return { ok: false, error: 'A recording is already running.' }
    const wanted = parseSources(req.sources).filter((s) => deps.sources[s])
    if (!wanted.length) return { ok: false, error: 'Choose at least one thing to record: Pawn browser or Mac apps.' }
    const s: Session = {
      id: `rec-${now().toString(36)}-${randomBytes(3).toString('hex')}`,
      context: parseContext(req.context),
      goal: typeof req.goal === 'string' ? req.goal.trim().slice(0, 2000) : '',
      inputsHint: typeof req.inputsHint === 'string' ? req.inputsHint.trim().slice(0, 1000) : '',
      sources: [],
      startedAt: now(),
      events: [],
      frames: [],
      framesCaptured: 0,
      notes: [],
      lastFrameAt: 0,
      frameTimer: null,
      pendingFrameSource: null,
      limitTimer: null,
      progressTimer: null,
      stopping: false,
      finishing: false
    }
    session = s
    const errors: string[] = []
    for (const src of wanted) {
      const adapter = deps.sources[src]!
      try {
        const r = await adapter.start((raw) => onRaw(s, src, raw))
        if (r.ok) s.sources.push(src)
        else if (r.error) errors.push(r.error)
        for (const n of r.notes || []) s.notes.push(n)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    if (session !== s) {
      await stopSources(s)
      return { ok: false, error: 'Recording was cancelled while starting.' }
    }
    if (!s.sources.length) {
      session = null
      return { ok: false, error: errors.join(' ') || 'Nothing could be recorded.' }
    }
    for (const e of errors) s.notes.push(e)
    s.limitTimer = setTimer(() => {
      if (session === s) {
        s.notes.push('Recording stopped at the 30-minute limit.')
        void stop('time_limit')
      }
    }, RECORDER_LIMITS.maxDurationMs)
    // The starting screen, so the model sees where the demo began.
    for (const src of s.sources) void grabFrame(s, src)
    const st = status()
    deps.emit({ type: 'started', status: st })
    return { ok: true, status: st }
  }

  function teardown(s: Session): void {
    for (const h of [s.frameTimer, s.limitTimer, s.progressTimer]) if (h) clearTimer(h)
    s.frameTimer = s.limitTimer = s.progressTimer = null
  }

  async function stopSources(s: Session): Promise<void> {
    await Promise.all(
      s.sources.map(async (src) => {
        try {
          await deps.sources[src]?.stop()
        } catch {
          /* best effort */
        }
      })
    )
  }

  /** Stop, build the bundle, hand it over once, and drop every raw event and frame. */
  async function stop(reason: StopReason = 'user'): Promise<{ ok: boolean; error?: string; steps?: number }> {
    const s = session
    if (!s || s.finishing) return { ok: false, error: 'No recording is running.' }
    s.finishing = true
    teardown(s)
    // Esc×2 ended the recording: those key presses aren't part of the task
    // (events flushed by stopping the sources land after this point).
    if (reason === 'esc') {
      let n = 0
      for (let i = s.events.length - 1; i >= 0 && n < 2; i--) {
        const e = s.events[i]
        if (e.kind !== 'key' || e.key !== 'Escape') break
        s.events.splice(i, 1)
        n++
      }
    }
    // Stopping a source flushes what it still holds (text typed a moment ago),
    // so events keep flowing in until the sources are down and have settled.
    await stopSources(s)
    await new Promise<void>((r) => setTimer(r, settleMs))
    if (session !== s) return { ok: false, error: 'Recording was cancelled.' }
    s.stopping = true
    // Final picture of the end state (what "done" looks like).
    const lastSource = s.events[s.events.length - 1]?.source || s.sources[0]
    if (lastSource) await grabFrame(s, lastSource)
    if (session !== s) return { ok: false, error: 'Recording was cancelled.' }
    const events = normalizeEvents(s.events)
    const steps = buildSteps(events)
    const { text: stepsText, truncated } = formatSteps(steps)
    const bundle: RecordingBundle = {
      id: s.id,
      context: s.context,
      goal: s.goal,
      inputsHint: s.inputsHint,
      startedAt: s.startedAt,
      durationMs: elapsed(s),
      sources: s.sources,
      steps,
      stepsText,
      frames: pickKeyframes(s.frames, steps),
      stats: { events: s.events.length, steps: steps.length, framesCaptured: s.framesCaptured, truncated, stopReason: reason },
      notes: Array.from(new Set(s.notes))
    }
    // Forget the raw recording before anything else can observe it.
    s.events = []
    s.frames = []
    session = null
    deps.emit({ type: 'finished', bundle })
    return { ok: true, steps: steps.length }
  }

  async function cancel(reason?: string): Promise<{ ok: boolean }> {
    const s = session
    if (!s) return { ok: false }
    s.stopping = true
    s.finishing = true
    teardown(s)
    session = null
    s.events = []
    s.frames = []
    await stopSources(s)
    deps.emit({ type: 'cancelled', reason })
    return { ok: true }
  }

  /**
   * A source died mid-recording (native helper crashed): tell the drafting
   * model, and finish with what was captured when nothing else is recording.
   */
  function sourceLost(source: RecordingSource, message: string): void {
    const s = session
    if (!s || s.finishing || !s.sources.includes(source)) return
    s.sources = s.sources.filter((x) => x !== source)
    s.notes.push(message)
    scheduleProgress()
    if (!s.sources.length) void stop('user')
  }

  return { status, start, stop, cancel, sourceLost, isRecording: () => session !== null }
}
