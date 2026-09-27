import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildSteps,
  describeElement,
  formatKey,
  formatSteps,
  normalizeEvents,
  pickKeyframes,
  redactUrl,
  sanitizeEvent,
  thinFrames
} from '../recorder/timeline'
import { createRecorderService, type RecorderSourceAdapter } from '../recorder/service'
import { isRecorderMessage, parseRecorderMessage } from '../recorder/browserScript'
import { frontMatter, saveUserSkill, readUserSkill, slugifySkillName, validateSkill } from '../localSkills'
import type { RecEvent, RecorderEvent } from '../recorder/types'
import { recordLabels } from '../trayLabels'

const ev = (t: number, kind: RecEvent['kind'], extra: Partial<RecEvent> = {}): RecEvent => ({ t, source: 'browser', kind, ...extra })

describe('sanitizeEvent', () => {
  it('drops unknown kinds and malformed input', () => {
    expect(sanitizeEvent(null, 'browser', 0)).toBeNull()
    expect(sanitizeEvent({ kind: 'exec' }, 'browser', 0)).toBeNull()
    expect(sanitizeEvent('click', 'browser', 0)).toBeNull()
  })

  it('never keeps a password value, even if a forged event carries one', () => {
    const e = sanitizeEvent({ kind: 'input', target: { tag: 'input', inputType: 'password', name: 'pw' }, value: 'hunter2' }, 'browser', 10)
    expect(e).toMatchObject({ kind: 'input', secret: true })
    expect(e?.value).toBeUndefined()
    const byName = sanitizeEvent({ kind: 'input', target: { tag: 'input', name: 'otp_code' }, value: '123456' }, 'browser', 10)
    expect(byName?.secret).toBe(true)
    const ax = sanitizeEvent({ kind: 'input', target: { role: 'AXSecureTextField', label: 'Password' }, value: 'x' }, 'desktop', 10)
    expect(ax?.secret).toBe(true)
  })

  it('redacts secrets in values and URLs and masks card numbers', () => {
    const e = sanitizeEvent(
      { kind: 'input', target: { tag: 'textarea', label: 'Notes' }, value: 'key sk-abcdefghijklmnopqrstu card 4111 1111 1111 1234' },
      'browser',
      5
    )
    expect(e?.value).not.toContain('sk-abcdefghijkl')
    expect(e?.value).toContain('•••• 1234')
    expect(redactUrl('https://u:p@x.com/cb?code=abc&state=ok#access_token=zzz')).toBe('https://x.com/cb?code=REDACTED&state=ok#REDACTED')
    const nav = sanitizeEvent({ kind: 'navigate', url: 'javascript:alert(1)' }, 'browser', 0)
    expect(nav?.url).toBeUndefined()
  })

  it('clips long strings', () => {
    const e = sanitizeEvent({ kind: 'click', target: { tag: 'button', label: 'x'.repeat(500) } }, 'browser', 0)
    expect(e!.target!.label!.length).toBeLessThanOrEqual(120)
  })
})

describe('normalizeEvents', () => {
  const email = { tag: 'input', inputType: 'email', name: 'email', label: 'Email', selector: 'input[name="email"]' }
  it('collapses typing bursts and the click that focused the field', () => {
    const out = normalizeEvents([
      ev(0, 'navigate', { url: 'https://a.com/login' }),
      ev(100, 'click', { url: 'https://a.com/login', target: email }),
      ev(200, 'input', { url: 'https://a.com/login', target: email, value: 'j' }),
      ev(900, 'input', { url: 'https://a.com/login', target: email, value: 'jane@x.com' }),
      ev(1500, 'click', { url: 'https://a.com/login', target: { tag: 'button', label: 'Sign in' } })
    ])
    expect(out.map((e) => e.kind)).toEqual(['navigate', 'input', 'click'])
    expect(out[1].value).toBe('jane@x.com')
  })

  it('merges redirect chains, patches titles, drops trailing scrolls', () => {
    const out = normalizeEvents([
      ev(0, 'navigate', { url: 'https://a.com/' }),
      ev(300, 'navigate', { url: 'https://a.com/home' }),
      ev(500, 'title', { url: 'https://a.com/home', title: 'Home' }),
      ev(5000, 'scroll', { direction: 'down', url: 'https://a.com/home' }),
      ev(5100, 'scroll', { direction: 'down', url: 'https://a.com/home' })
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ url: 'https://a.com/home', title: 'Home' })
  })

  it('drops a form submit that a button click or Enter already explains', () => {
    const out = normalizeEvents([
      ev(0, 'click', { target: { tag: 'button', label: 'Save' } }),
      ev(40, 'submit', { target: { tag: 'form' } }),
      ev(2000, 'key', { key: 'Enter' }),
      ev(2030, 'submit', {}),
      ev(9000, 'submit', {})
    ])
    expect(out.map((e) => e.kind)).toEqual(['click', 'key', 'submit'])
  })

  it('sorts merged browser + desktop streams by time', () => {
    const out = normalizeEvents([
      { t: 50, source: 'desktop', kind: 'app', app: 'Finder' },
      ev(10, 'navigate', { url: 'https://a.com/' }),
      { t: 90, source: 'desktop', kind: 'click', app: 'Finder', target: { role: 'AXButton', label: 'Share' } }
    ])
    expect(out.map((e) => `${e.source}:${e.kind}`)).toEqual(['browser:navigate', 'desktop:app', 'desktop:click'])
  })
})

describe('steps', () => {
  it('describes actions in plain words', () => {
    expect(describeElement({ role: 'AXButton', label: 'Export' })).toBe('button "Export"')
    expect(describeElement({ tag: 'input', inputType: 'checkbox', label: 'Remember me' })).toBe('checkbox "Remember me"')
    expect(describeElement({ tag: 'a', label: 'Reports' })).toBe('link "Reports"')
    expect(formatKey('cmd+shift+s')).toBe('⌘⇧S')
    const steps = buildSteps([
      ev(0, 'navigate', { url: 'https://exp.co/new', title: 'New expense' }),
      ev(1000, 'input', { url: 'https://exp.co/new', target: { tag: 'input', label: 'Amount' }, value: '42.50' }),
      ev(2000, 'input', { url: 'https://exp.co/new', target: { tag: 'input', inputType: 'password', label: 'PIN' }, secret: true }),
      ev(3000, 'input', { url: 'https://exp.co/new', target: { tag: 'input', inputType: 'file', label: 'Receipt' }, value: 'receipt.pdf' }),
      ev(4000, 'click', { url: 'https://exp.co/new', target: { tag: 'input', inputType: 'checkbox', label: 'Billable' }, checked: true }),
      { t: 5000, source: 'desktop', kind: 'key', app: 'Numbers', key: 'cmd+s' }
    ])
    expect(steps.map((s) => s.text)).toEqual([
      'Open "New expense" (https://exp.co/new)',
      'Type "42.50" into text field "Amount"',
      'Enter a secret value into password field "PIN" (not recorded — ask the user or use their saved login)',
      'Choose file "receipt.pdf" in file picker "Receipt"',
      'Check checkbox "Billable"',
      'Press ⌘S'
    ])
    expect(steps[0].context).toBe('Pawn browser · exp.co')
    expect(steps[5].context).toBe('Numbers')
  })

  it('elides the middle of very long recordings', () => {
    const steps = buildSteps(Array.from({ length: 300 }, (_, i) => ev(i * 10, 'click', { url: 'https://a.com/', target: { tag: 'button', label: `B${i}` } })))
    const { text, truncated } = formatSteps(steps, 100)
    expect(truncated).toBe(true)
    expect(text).toContain('200 steps omitted')
    expect(text).toContain('300. (00:02) Click button "B299"')
    expect(text.split('\n')[0]).toBe('1. (00:00) [Pawn browser · a.com] Click button "B0"')
  })
})

describe('frames', () => {
  it('thins frames but keeps the first and last', () => {
    const frames = Array.from({ length: 100 }, (_, i) => ({ t: i }))
    const out = thinFrames(frames, 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out[0].t).toBe(0)
    expect(out[out.length - 1].t).toBe(99)
  })

  it('picks spread-out keyframes tied to their steps', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({ t: i * 1000, source: 'browser' as const, dataUrl: 'data:image/jpeg;base64,x', width: 1, height: 1 }))
    const steps = buildSteps([ev(0, 'navigate', { url: 'https://a.com/' }), ev(10_500, 'click', { target: { tag: 'button', label: 'Go' } })])
    const picked = pickKeyframes(frames, steps, 5)
    expect(picked).toHaveLength(5)
    expect(picked[0]).toMatchObject({ t: 0, step: 1 })
    expect(picked[picked.length - 1]).toMatchObject({ t: 29_000, step: 2 })
  })
})

describe('recorder console channel', () => {
  it('only accepts lines with the current nonce', () => {
    expect(parseRecorderMessage('__pawnrec:abc:{"kind":"click"}', 'abc')).toEqual({ kind: 'click' })
    expect(parseRecorderMessage('__pawnrec:zzz:{"kind":"click"}', 'abc')).toBeNull()
    expect(parseRecorderMessage('__pawnrec:abc:not json', 'abc')).toBeNull()
    expect(isRecorderMessage('__pawnrec:zzz:{}')).toBe(true)
    expect(isRecorderMessage('hello')).toBe(false)
  })
})

function fakeSource(frames = true): RecorderSourceAdapter & { emit: (raw: unknown) => void; stopped: number } {
  let cb: ((raw: unknown) => void) | null = null
  const s = {
    stopped: 0,
    emit: (raw: unknown) => cb?.(raw),
    start: async (onEvent: (raw: unknown) => void) => {
      cb = onEvent
      return { ok: true }
    },
    stop: async () => {
      s.stopped++
      // A flush on stop still lands in the recording.
      cb?.({ kind: 'input', target: { tag: 'input', label: 'Search' }, value: 'late' })
      cb = null
    },
    capture: async () => (frames ? { dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 10 } : null)
  }
  return s
}

describe('recorder service', () => {
  it('is macOS only and needs a source', async () => {
    const svc = createRecorderService({ sources: { browser: fakeSource() }, emit: () => {}, platform: 'linux' })
    expect(await svc.start({ sources: ['browser'] })).toMatchObject({ ok: false })
    const mac = createRecorderService({ sources: { browser: fakeSource() }, emit: () => {}, platform: 'darwin' })
    expect(await mac.start({ sources: [] })).toMatchObject({ ok: false })
  })

  it('records, hands over one bundle with flushed input, then forgets', async () => {
    const events: RecorderEvent[] = []
    const browser = fakeSource()
    const svc = createRecorderService({ sources: { browser }, emit: (e) => events.push(e), platform: 'darwin', settleMs: 1 })
    const r = await svc.start({ goal: 'File an expense', inputsHint: 'amount', sources: ['browser'], context: { projectId: 'p1', sessionId: 's1', evil: '<x>' } })
    expect(r.ok).toBe(true)
    expect(await svc.start({ sources: ['browser'] })).toMatchObject({ ok: false })
    browser.emit({ kind: 'navigate', url: 'https://exp.co/new', title: 'New' })
    browser.emit({ kind: 'click', target: { tag: 'button', label: 'Add' } })
    browser.emit({ kind: 'bogus' })
    expect(svc.status()).toMatchObject({ state: 'recording', goal: 'File an expense', steps: 2, context: { projectId: 'p1', sessionId: 's1' } })
    const done = await svc.stop()
    expect(done).toMatchObject({ ok: true, steps: 3 })
    expect(browser.stopped).toBe(1)
    const fin = events.find((e) => e.type === 'finished')
    if (fin?.type !== 'finished') throw new Error('no bundle')
    expect(fin.bundle).toMatchObject({ goal: 'File an expense', inputsHint: 'amount', sources: ['browser'], context: { projectId: 'p1', sessionId: 's1' } })
    expect(fin.bundle.steps.map((s) => s.text)).toEqual(['Open "New" (https://exp.co/new)', 'Click button "Add"', 'Type "late" into text field "Search"'])
    expect(fin.bundle.frames.length).toBeGreaterThan(0)
    expect(svc.status()).toEqual({ state: 'idle' })
    expect(await svc.stop()).toMatchObject({ ok: false })
  })

  it('cancel drops everything and emits no bundle', async () => {
    const events: RecorderEvent[] = []
    const browser = fakeSource()
    const svc = createRecorderService({ sources: { browser }, emit: (e) => events.push(e), platform: 'darwin' })
    await svc.start({ sources: ['browser'] })
    browser.emit({ kind: 'click', target: { tag: 'button', label: 'X' } })
    await svc.cancel()
    expect(events.some((e) => e.type === 'finished')).toBe(false)
    expect(events.some((e) => e.type === 'cancelled')).toBe(true)
    expect(svc.status().state).toBe('idle')
  })

  it('keeps going with the sources that started and reports the others', async () => {
    const browser = fakeSource()
    const desktop: RecorderSourceAdapter = {
      start: async () => ({ ok: false, error: 'Accessibility permission missing' }),
      stop: vi.fn(async () => {}),
      capture: async () => null
    }
    const svc = createRecorderService({ sources: { browser, desktop }, emit: () => {}, platform: 'darwin' })
    const r = await svc.start({ sources: ['browser', 'desktop'] })
    expect(r).toMatchObject({ ok: true, status: { sources: ['browser'], notes: ['Accessibility permission missing'] } })
    await svc.cancel()
    const onlyDesktop = createRecorderService({ sources: { desktop }, emit: () => {}, platform: 'darwin' })
    expect(await onlyDesktop.start({ sources: ['desktop'] })).toEqual({ ok: false, error: 'Accessibility permission missing' })
  })

  it('stops itself at the event limit', async () => {
    const events: RecorderEvent[] = []
    const browser = fakeSource(false)
    const svc = createRecorderService({ sources: { browser }, emit: (e) => events.push(e), platform: 'darwin', settleMs: 1 })
    await svc.start({ sources: ['browser'] })
    for (let i = 0; i < 3100; i++) browser.emit({ kind: 'click', target: { tag: 'button', label: `b${i % 7}` } })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'finished')).toBe(true))
    const fin = events.find((e) => e.type === 'finished')
    if (fin?.type === 'finished') expect(fin.bundle.stats.stopReason).toBe('event_limit')
  })
})

describe('local skills', () => {
  const good = '---\nname: file-expense\ndescription: File an expense report with a receipt in the Expensify web app.\n---\n\n# File an expense\n'
  it('validates names and front matter', () => {
    expect(slugifySkillName('File Expense (Q3)!')).toBe('file-expense-q3')
    expect(slugifySkillName('경비 제출')).toBe('')
    expect(validateSkill('file-expense', good)).toEqual({ ok: true })
    expect(validateSkill('File', good).ok).toBe(false)
    expect(validateSkill('other-name', good).ok).toBe(false)
    expect(validateSkill('file-expense', '# no front matter').ok).toBe(false)
    expect(frontMatter('---\nname: a\ndescription: >\n  line one\n  line two\n---\nbody').description).toBe('line one line two')
  })

  it('saves atomically, refuses silent overwrite, and reads back', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pawn-skills-'))
    try {
      const r = await saveUserSkill('file-expense', good, { home })
      expect(r).toMatchObject({ ok: true, created: true })
      if (r.ok) expect(readFileSync(r.path, 'utf8')).toBe(good)
      expect(await saveUserSkill('file-expense', good, { home })).toMatchObject({ ok: false, exists: true })
      expect(await saveUserSkill('file-expense', good.replace('# File', '# Filed'), { home, overwrite: true })).toMatchObject({ ok: true, created: false })
      expect(await readUserSkill('file-expense', home)).toMatchObject({ ok: true })
      expect(await readUserSkill('../etc', home)).toMatchObject({ ok: false })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('tray record labels', () => {
  it('has every language', () => {
    for (const l of ['en', 'ko', 'ja', 'zh']) expect(recordLabels(l).pill).toMatch(/Esc/)
    expect(recordLabels('xx')).toEqual(recordLabels('en'))
  })
})
