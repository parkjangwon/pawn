/**
 * Record & Replay: the user demonstrates a workflow once (Pawn's browser and/or
 * Mac apps), Pawn turns the recording into a reusable SKILL.md, and the agent
 * replays it later with the tools it has (browser_*, computer_*, MCP).
 *
 * The raw recording (events + screenshots) only ever lives in memory. It is
 * handed to the renderer once for drafting and then dropped — never written to
 * disk.
 *
 * Pure types (no electron imports): shared by main, tests and the renderer.
 */

export type RecordingSource = 'browser' | 'desktop'

/** What was acted on — semantic identity, not pixels, so replay survives layout changes. */
export interface RecElement {
  /** ARIA role / AX role (AXButton, button, link, textbox…). */
  role?: string
  tag?: string
  /** Accessible name / visible text. */
  label?: string
  /** `name` attribute of a form control. */
  name?: string
  placeholder?: string
  /** input type (text, email, checkbox, file…). */
  inputType?: string
  /** Stable-ish CSS selector (browser only). */
  selector?: string
  href?: string
  id?: string
}

export type RecEventKind =
  | 'navigate'
  | 'title'
  | 'click'
  | 'input'
  | 'select'
  | 'submit'
  | 'key'
  | 'scroll'
  | 'app'
  | 'tab'

export interface RecEvent {
  /** ms since the recording started. */
  t: number
  source: RecordingSource
  kind: RecEventKind
  url?: string
  title?: string
  app?: string
  bundleId?: string
  window?: string
  target?: RecElement
  /** Typed / selected value (already redacted). */
  value?: string
  /** A value was entered but deliberately not recorded (password, secure field). */
  secret?: boolean
  /** Key or shortcut, e.g. "Enter", "cmd+s". */
  key?: string
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
  checked?: boolean
  direction?: 'up' | 'down' | 'left' | 'right'
}

export interface RecFrame {
  t: number
  source: RecordingSource
  /** data:image/jpeg;base64,… */
  dataUrl: string
  width: number
  height: number
}

export interface RecStep {
  index: number
  t: number
  source: RecordingSource
  kind: RecEventKind
  /** Where it happened: site host or app (+ window). */
  context: string
  /** Human-readable action, e.g. `Click button "Submit"`. */
  text: string
}

export type StopReason = 'user' | 'time_limit' | 'event_limit' | 'window_closed' | 'esc'

/** Where the renderer wants the draft to go (opaque to main). */
export interface RecordingContext {
  projectId?: string
  sessionId?: string
}

export interface RecordingBundle {
  id: string
  context: RecordingContext
  goal: string
  /** What the user said changes between runs. */
  inputsHint: string
  startedAt: number
  durationMs: number
  sources: RecordingSource[]
  steps: RecStep[]
  /** Numbered step list for the drafting prompt (long recordings elided). */
  stepsText: string
  /** Keyframes for the drafting model, each tied to the step it follows. */
  frames: Array<RecFrame & { step: number }>
  stats: {
    events: number
    steps: number
    framesCaptured: number
    /** Steps were elided to fit the prompt. */
    truncated: boolean
    stopReason: StopReason
  }
  /** Warnings worth telling the drafting model / the user (missing permission…). */
  notes: string[]
}

export interface RecordingStatus {
  state: 'idle' | 'recording'
  id?: string
  context?: RecordingContext
  goal?: string
  sources?: RecordingSource[]
  startedAt?: number
  elapsedMs?: number
  steps?: number
  lastStep?: string
  notes?: string[]
}

export type RecorderEvent =
  | { type: 'started'; status: RecordingStatus }
  | { type: 'progress'; status: RecordingStatus }
  | { type: 'finished'; bundle: RecordingBundle }
  | { type: 'cancelled'; reason?: string }
  | { type: 'error'; error: string }
  /** Tray / menu asked the renderer to open the recording setup. */
  | { type: 'open-setup' }

export const RECORDER_LIMITS = {
  maxDurationMs: 30 * 60_000,
  maxEvents: 3000,
  /** Frames kept in memory while recording (thinned when exceeded). */
  maxFramesKept: 48,
  /** Frames sent to the drafting model. */
  maxKeyframes: 8,
  /** Steps listed in the drafting prompt (middle elided beyond). */
  maxPromptSteps: 180,
  maxValueChars: 300,
  maxLabelChars: 120
} as const
