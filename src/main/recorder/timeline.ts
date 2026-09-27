/**
 * Recording timeline: validate raw events from the (untrusted) recorders,
 * redact secrets, collapse noise (keystroke bursts, redirects, scroll wheels)
 * and turn what is left into numbered human-readable steps plus a handful of
 * keyframes for the drafting model.
 *
 * Pure functions — no electron, no I/O.
 */

import { redactSecrets } from '../decision/redact'
import {
  RECORDER_LIMITS,
  type RecElement,
  type RecEvent,
  type RecEventKind,
  type RecFrame,
  type RecStep,
  type RecordingSource
} from './types'

const KINDS: ReadonlySet<RecEventKind> = new Set<RecEventKind>([
  'navigate',
  'title',
  'click',
  'input',
  'select',
  'submit',
  'key',
  'scroll',
  'app',
  'tab'
])

const SECRET_NAME = /pass(word|wd|code)?|pwd|secret|token|otp|one.?time|\bpin\b|cvv|cvc|csc|ssn|card.?(num|no)|security.?code|api.?key|auth/i
const SECRET_PARAM = /^(access_?token|id_?token|refresh_?token|token|auth|authorization|code|key|api_?key|apikey|secret|password|passwd|pwd|sig|signature|session|sessionid|sid|jwt|otp|x-amz-[a-z-]+)$/i

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

/** Mask secret-looking query params and credentials in a URL. */
export function redactUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw
  try {
    const u = new URL(raw)
    if (u.username || u.password) {
      u.username = ''
      u.password = ''
    }
    for (const k of Array.from(u.searchParams.keys())) {
      if (SECRET_PARAM.test(k) || SECRET_NAME.test(k)) u.searchParams.set(k, 'REDACTED')
    }
    // OAuth implicit flows put tokens in the fragment.
    if (/(access_token|id_token|token)=/i.test(u.hash)) u.hash = '#REDACTED'
    return redactSecrets(u.toString())
  } catch {
    return redactSecrets(raw)
  }
}

/** Long digit runs (cards, accounts) keep only their last 4 digits. */
function maskDigits(s: string): string {
  return s.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, '')
    return `•••• ${digits.slice(-4)}`
  })
}

export function redactValue(v: string | undefined): string | undefined {
  if (v === undefined) return v
  return maskDigits(redactSecrets(v))
}

function sanitizeElement(raw: unknown): RecElement | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const L = RECORDER_LIMITS.maxLabelChars
  const el: RecElement = {
    role: str(o.role, 40),
    tag: str(o.tag, 20)?.toLowerCase(),
    label: redactValue(str(o.label, L)),
    name: str(o.name, 60),
    placeholder: str(o.placeholder, L),
    inputType: str(o.inputType, 20)?.toLowerCase(),
    selector: str(o.selector, 240),
    href: redactUrl(str(o.href, 500)),
    id: str(o.id, 80)
  }
  for (const k of Object.keys(el) as (keyof RecElement)[]) if (el[k] === undefined) delete el[k]
  return Object.keys(el).length ? el : undefined
}

/** A field whose value must never be recorded. */
export function isSecretElement(el: RecElement | undefined): boolean {
  if (!el) return false
  if (el.inputType === 'password') return true
  if (el.role === 'AXSecureTextField') return true
  return [el.name, el.id, el.label, el.placeholder].some((s) => !!s && SECRET_NAME.test(s))
}

/**
 * Validate one raw event from a recorder. Browser events come from a script
 * in the page's renderer process, so every field is treated as untrusted.
 */
export function sanitizeEvent(raw: unknown, source: RecordingSource, t: number): RecEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind as RecEventKind
  if (!KINDS.has(kind)) return null
  const ev: RecEvent = { t: Math.max(0, Math.round(t)), source, kind }
  const url = redactUrl(str(o.url, 800))
  if (url && /^(https?|file):/i.test(url)) ev.url = url
  const title = redactValue(str(o.title, 160))
  if (title) ev.title = title
  const app = str(o.app, 80)
  if (app) ev.app = app
  const bundleId = str(o.bundleId, 120)
  if (bundleId) ev.bundleId = bundleId
  const win = redactValue(str(o.window, 160))
  if (win) ev.window = win
  const target = sanitizeElement(o.target)
  if (target) ev.target = target
  const key = str(o.key, 40)
  if (key) ev.key = key
  if (o.button === 'left' || o.button === 'right' || o.button === 'middle') ev.button = o.button
  const cc = num(o.clickCount)
  if (cc !== undefined && cc >= 1) ev.clickCount = Math.min(3, Math.round(cc))
  if (typeof o.checked === 'boolean') ev.checked = o.checked
  if (o.direction === 'up' || o.direction === 'down' || o.direction === 'left' || o.direction === 'right') ev.direction = o.direction
  const secret = o.secret === true || isSecretElement(target)
  if (secret && (kind === 'input' || kind === 'select')) {
    ev.secret = true
  } else if (typeof o.value === 'string') {
    const v = redactValue(str(o.value, RECORDER_LIMITS.maxValueChars))
    if (v !== undefined) ev.value = v
  }
  return ev
}

// --- Normalization ----------------------------------------------------------

function fieldKey(e: RecEvent): string {
  const t = e.target || {}
  const where = e.source === 'browser' ? originOf(e.url) : `${e.bundleId || e.app || ''}|${e.window || ''}`
  return `${e.source}|${where}|${t.selector || ''}|${t.name || ''}|${t.id || ''}|${t.label || ''}|${t.role || t.tag || ''}`
}

function originOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

const TEXT_ROLES = /^(AXTextField|AXTextArea|AXSearchField|AXComboBox|AXSecureTextField|textbox|searchbox|combobox)$/
const TEXT_TYPES = new Set(['text', 'email', 'search', 'tel', 'url', 'number', 'password', 'date', 'datetime-local', 'month', 'time', 'week'])

export function isTextEntry(el: RecElement | undefined): boolean {
  if (!el) return false
  if (el.tag === 'textarea') return true
  if (el.tag === 'input') return !el.inputType || TEXT_TYPES.has(el.inputType)
  return !!el.role && TEXT_ROLES.test(el.role)
}

/**
 * Collapse the raw stream into meaningful actions:
 * - consecutive inputs into the same field → the final value
 * - a click into a text field right before typing into it → dropped
 * - redirect chains / repeated navigations → the last one
 * - scroll bursts and rapid app switches → one
 * - `title` events patch the preceding navigation instead of becoming steps
 */
export function normalizeEvents(input: RecEvent[]): RecEvent[] {
  const events = [...input].sort((a, b) => a.t - b.t)
  const out: RecEvent[] = []
  for (const e of events) {
    const prev = out[out.length - 1]
    if (e.kind === 'title') {
      for (let i = out.length - 1; i >= 0 && i >= out.length - 6; i--) {
        const n = out[i]
        if (n.kind === 'navigate' && n.source === e.source && (!e.url || n.url === e.url)) {
          if (e.title) n.title = e.title
          break
        }
      }
      continue
    }
    if (e.kind === 'input' && prev?.kind === 'input' && fieldKey(prev) === fieldKey(e)) {
      out[out.length - 1] = { ...e, t: prev.t }
      continue
    }
    if (e.kind === 'input' && prev?.kind === 'click' && isTextEntry(prev.target) && fieldKey(prev) === fieldKey(e)) {
      out[out.length - 1] = e
      continue
    }
    if (e.kind === 'navigate' && prev?.kind === 'navigate' && prev.source === e.source) {
      if (prev.url === e.url || e.t - prev.t < 1500) {
        out[out.length - 1] = { ...e, title: e.title || (prev.url === e.url ? prev.title : undefined) }
        continue
      }
    }
    if (e.kind === 'navigate' && e.url) {
      // A later navigation to the page we're already on (reload / hash noise).
      const lastNav = [...out].reverse().find((x) => x.kind === 'navigate' && x.source === e.source)
      if (lastNav && lastNav.url === e.url && out.indexOf(lastNav) >= out.length - 1) continue
    }
    // Clicking a submit button / pressing Enter already says it: the form's
    // own submit event adds nothing.
    if (e.kind === 'submit' && prev && prev.source === e.source && e.t - prev.t < 1500) {
      const t = prev.target
      const button = prev.kind === 'click' && !!t && (t.tag === 'button' || t.inputType === 'submit' || t.role === 'button')
      if (button || (prev.kind === 'key' && prev.key === 'Enter')) continue
    }
    if (e.kind === 'scroll' && prev?.kind === 'scroll' && prev.source === e.source && (prev.app === e.app || prev.url === e.url)) {
      out[out.length - 1] = { ...prev, direction: e.direction || prev.direction }
      continue
    }
    if (e.kind === 'app' && prev?.kind === 'app' && e.t - prev.t < 1200) {
      out[out.length - 1] = e
      continue
    }
    if (e.kind === 'app' && prev && prev.source === 'desktop' && prev.app === e.app && prev.kind !== 'app') {
      // Already in this app: the activation carries nothing new.
      continue
    }
    if (e.kind === 'tab' && prev?.kind === 'tab') {
      out[out.length - 1] = e
      continue
    }
    out.push({ ...e })
  }
  // A trailing lone scroll teaches nothing.
  while (out.length && out[out.length - 1].kind === 'scroll') out.pop()
  return out
}

// --- Steps ------------------------------------------------------------------

const AX_ROLE: Record<string, string> = {
  AXButton: 'button',
  AXLink: 'link',
  AXTextField: 'text field',
  AXTextArea: 'text area',
  AXSearchField: 'search field',
  AXSecureTextField: 'password field',
  AXComboBox: 'combo box',
  AXCheckBox: 'checkbox',
  AXRadioButton: 'option',
  AXPopUpButton: 'pop-up menu',
  AXMenuButton: 'menu button',
  AXMenuItem: 'menu item',
  AXMenuBarItem: 'menu',
  AXMenu: 'menu',
  AXTab: 'tab',
  AXTabGroup: 'tab bar',
  AXRow: 'row',
  AXCell: 'cell',
  AXOutlineRow: 'row',
  AXStaticText: 'text',
  AXImage: 'image',
  AXSlider: 'slider',
  AXDisclosureTriangle: 'disclosure triangle',
  AXToolbar: 'toolbar',
  AXList: 'list',
  AXTable: 'table',
  AXGroup: 'area',
  AXWindow: 'window',
  AXScrollArea: 'area',
  AXWebArea: 'page'
}

const WEB_ROLE: Record<string, string> = {
  a: 'link',
  button: 'button',
  select: 'drop-down',
  textarea: 'text area',
  summary: 'disclosure',
  label: 'label',
  img: 'image'
}

function kindOf(el: RecElement): string {
  if (el.role && AX_ROLE[el.role]) return AX_ROLE[el.role]
  if (el.role && /^[a-z]+$/.test(el.role)) {
    const r = el.role
    if (r === 'textbox') return 'text field'
    if (r === 'menuitem') return 'menu item'
    if (r === 'combobox') return 'combo box'
    if (r === 'searchbox') return 'search field'
    return r
  }
  if (el.tag === 'input') {
    const t = el.inputType || 'text'
    if (t === 'checkbox') return 'checkbox'
    if (t === 'radio') return 'option'
    if (t === 'file') return 'file picker'
    if (t === 'submit' || t === 'button' || t === 'reset') return 'button'
    if (t === 'password') return 'password field'
    if (t === 'search') return 'search field'
    return 'text field'
  }
  if (el.tag && WEB_ROLE[el.tag]) return WEB_ROLE[el.tag]
  return 'element'
}

/** `button "Submit"`, `text field "Email"`, `link "Reports"`. */
export function describeElement(el: RecElement | undefined): string {
  if (!el) return 'the page'
  const kind = kindOf(el)
  const name = el.label || el.placeholder || el.name || el.id || (el.href ? el.href.replace(/^https?:\/\//, '').slice(0, 60) : '')
  return name ? `${kind} "${name}"` : kind
}

function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function contextOf(e: RecEvent): string {
  if (e.source === 'browser') return `Pawn browser · ${hostOf(e.url) || 'page'}`
  const app = e.app || 'app'
  return e.window && e.window !== e.app ? `${app} — ${e.window}` : app
}

function quote(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`
}

const KEY_GLYPH: Record<string, string> = { cmd: '⌘', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧' }

export function formatKey(key: string): string {
  const parts = key.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 1) return key
  return parts.map((p) => KEY_GLYPH[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p)).join('')
}

export function stepText(e: RecEvent): string {
  const target = describeElement(e.target)
  switch (e.kind) {
    case 'navigate':
      return e.title ? `Open ${quote(e.title)} (${e.url || 'page'})` : `Open ${e.url || 'a page'}`
    case 'tab':
      return `Switch to browser tab ${quote(e.title || hostOf(e.url) || 'tab')}`
    case 'click': {
      if (e.target && (kindOf(e.target) === 'checkbox' || e.target.inputType === 'checkbox') && typeof e.checked === 'boolean') {
        return `${e.checked ? 'Check' : 'Uncheck'} ${target}`
      }
      const verb = e.button === 'right' ? 'Right-click' : (e.clickCount ?? 1) >= 2 ? 'Double-click' : 'Click'
      return `${verb} ${target}`
    }
    case 'input':
      if (e.secret) return `Enter a secret value into ${target} (not recorded — ask the user or use their saved login)`
      if (e.target?.inputType === 'file') return `Choose file ${quote(e.value || '')} in ${target}`
      return e.value !== undefined && e.value !== '' ? `Type ${quote(e.value)} into ${target}` : `Clear ${target}`
    case 'select':
      return e.secret ? `Choose a value in ${target}` : `Choose ${quote(e.value || '')} in ${target}`
    case 'submit':
      return `Submit the form${e.target ? ` ${target}` : ''}`
    case 'key':
      return `Press ${formatKey(e.key || 'a key')}${e.target ? ` in ${target}` : ''}`
    case 'scroll':
      return `Scroll ${e.direction || 'down'}`
    case 'app':
      return `Switch to ${e.app || 'another app'}`
    default:
      return e.kind
  }
}

export function buildSteps(events: RecEvent[]): RecStep[] {
  return events.map((e, i) => ({
    index: i + 1,
    t: e.t,
    source: e.source,
    kind: e.kind,
    context: contextOf(e),
    text: stepText(e)
  }))
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Numbered step list for the drafting prompt. Very long recordings keep the
 * beginning and the end (where the goal and the verification usually are).
 */
export function formatSteps(steps: RecStep[], max: number = RECORDER_LIMITS.maxPromptSteps): { text: string; truncated: boolean } {
  let list = steps
  let truncated = false
  let gap = -1
  if (steps.length > max) {
    const head = Math.ceil(max * 0.7)
    const tail = max - head
    list = [...steps.slice(0, head), ...steps.slice(steps.length - tail)]
    gap = head
    truncated = true
  }
  const lines: string[] = []
  let lastContext = ''
  list.forEach((s, i) => {
    if (i === gap) lines.push(`… ${steps.length - max} steps omitted …`)
    const ctx = s.context !== lastContext ? ` [${s.context}]` : ''
    lastContext = s.context
    lines.push(`${s.index}. (${clock(s.t)})${ctx} ${s.text}`)
  })
  return { text: lines.join('\n'), truncated }
}

// --- Frames -----------------------------------------------------------------

/** Keep at most `max` frames while recording: drop every other middle frame. */
export function thinFrames<T extends { t: number }>(frames: T[], max: number): T[] {
  if (frames.length <= max) return frames
  const first = frames[0]
  const last = frames[frames.length - 1]
  const middle = frames.slice(1, -1).filter((_, i) => i % 2 === 1)
  const out = [first, ...middle, last]
  return out.length > max ? thinFrames(out, max) : out
}

/**
 * Pick keyframes spread over the recording and tie each to the last step at
 * or before it (so the model knows what the screen shows).
 */
export function pickKeyframes(
  frames: RecFrame[],
  steps: RecStep[],
  max: number = RECORDER_LIMITS.maxKeyframes
): Array<RecFrame & { step: number }> {
  const sorted = [...frames].sort((a, b) => a.t - b.t)
  if (!sorted.length || max <= 0) return []
  let chosen: RecFrame[]
  if (sorted.length <= max) chosen = sorted
  else {
    chosen = []
    for (let i = 0; i < max; i++) chosen.push(sorted[Math.round((i * (sorted.length - 1)) / (max - 1 || 1))])
    chosen = Array.from(new Set(chosen))
  }
  return chosen.map((f) => {
    let step = 0
    for (const s of steps) {
      if (s.t <= f.t) step = s.index
      else break
    }
    return { ...f, step }
  })
}
