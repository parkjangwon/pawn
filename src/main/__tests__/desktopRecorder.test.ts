import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { createDesktopSource } from '../recorder/desktopSource'
import { createRecorderService } from '../recorder/service'
import type { CuaHelper } from '../computer/cuaHelper'
import type { RecorderEvent } from '../recorder/types'

class FakeHelper extends EventEmitter {
  isAvailable = true
  calls: Array<{ method: string; params: Record<string, unknown> }> = []
  methods = ['screenshot', 'record_start', 'record_stop']
  perms = { accessibility: true, screenRecording: true }
  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'capabilities') return { methods: this.methods }
    if (method === 'permissions') return this.perms
    if (method === 'record_stop') {
      // The helper flushes pending typing before it replies.
      this.emit('rec', { event: 'rec', data: { kind: 'input', app: 'Notes', target: { role: 'AXTextArea', label: 'Body' }, value: 'last words' } })
      return { ok: true }
    }
    if (method === 'screenshot') return { data: 'QUJD', mime: 'image/jpeg', width: 1280, height: 800 }
    return { ok: true }
  }
}

const asHelper = (h: FakeHelper): CuaHelper => h as unknown as CuaHelper

describe('desktop recording source', () => {
  it('explains what is missing: helper, rebuild, permission', async () => {
    const none = createDesktopSource({ helper: () => null, ignorePids: () => [], onStopRequest: () => {} })
    expect(await none.readiness()).toMatchObject({ supported: false, error: expect.stringContaining('native helper') })
    const old = new FakeHelper()
    old.methods = ['screenshot']
    const oldSrc = createDesktopSource({ helper: () => asHelper(old), ignorePids: () => [], onStopRequest: () => {} })
    expect(await oldSrc.readiness()).toMatchObject({ supported: false, error: expect.stringContaining('too old') })
    const noAx = new FakeHelper()
    noAx.perms = { accessibility: false, screenRecording: true }
    const noAxSrc = createDesktopSource({ helper: () => asHelper(noAx), ignorePids: () => [], onStopRequest: () => {} })
    expect(await noAxSrc.start(() => {})).toMatchObject({ ok: false, error: expect.stringContaining('Accessibility') })
    expect(noAx.calls.some((c) => c.method === 'record_start')).toBe(false)
  })

  it('records helper events into the merged timeline and excludes Pawn from screenshots', async () => {
    const h = new FakeHelper()
    const stopRequested = vi.fn()
    let svc: ReturnType<typeof createRecorderService>
    const desktop = createDesktopSource({
      helper: () => asHelper(h),
      ignorePids: () => [4242],
      onStopRequest: () => {
        stopRequested()
        void svc.stop('esc')
      },
      pillText: () => 'Pawn is recording'
    })
    let browserCb: ((raw: unknown) => void) | null = null
    const events: RecorderEvent[] = []
    svc = createRecorderService({
      sources: {
        desktop,
        browser: {
          start: async (cb) => {
            browserCb = cb
            return { ok: true }
          },
          stop: async () => {},
          capture: async () => null
        }
      },
      emit: (e) => events.push(e),
      platform: 'darwin',
      settleMs: 1
    })
    const started = await svc.start({ goal: 'Share the report', sources: ['browser', 'desktop'] })
    expect(started).toMatchObject({ ok: true, status: { sources: ['browser', 'desktop'] } })
    expect(h.calls.find((c) => c.method === 'record_start')?.params).toEqual({ ignorePids: [4242], pill: 'Pawn is recording' })

    h.emit('rec', { event: 'rec', data: { kind: 'app', app: 'Finder', bundleId: 'com.apple.finder' } })
    h.emit('rec', { event: 'rec', data: { kind: 'click', app: 'Finder', window: 'Downloads', target: { role: 'AXRow', label: 'report.pdf' }, button: 'left', clickCount: 2 } })
    browserCb!({ kind: 'navigate', url: 'https://drive.example.com/upload', title: 'Upload' })
    h.emit('rec', { event: 'rec', data: { kind: 'input', app: 'Mail', target: { role: 'AXTextField', label: 'Password', inputType: undefined }, secret: true, value: 'should-not-appear' } })
    h.emit('rec', { event: 'rec', data: { kind: 'key', app: 'Finder', key: 'Escape' } })
    h.emit('rec', { event: 'rec', data: { kind: 'key', app: 'Finder', key: 'Escape' } })
    h.emit('record_stop_request', { event: 'record_stop_request' })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'finished')).toBe(true))
    expect(stopRequested).toHaveBeenCalled()
    expect(h.calls.some((c) => c.method === 'record_stop')).toBe(true)
    const shot = h.calls.find((c) => c.method === 'screenshot')
    expect(shot?.params).toMatchObject({ excludePids: [4242], excludeOwn: true, maxLongEdge: 1280 })

    const fin = events.find((e) => e.type === 'finished')
    if (fin?.type !== 'finished') throw new Error('no bundle')
    expect(fin.bundle.stats.stopReason).toBe('esc')
    expect(fin.bundle.steps.map((s) => s.text)).toEqual([
      'Switch to Finder',
      'Double-click row "report.pdf"',
      'Open "Upload" (https://drive.example.com/upload)',
      'Enter a secret value into text field "Password" (not recorded — ask the user or use their saved login)',
      'Type "last words" into text area "Body"'
    ])
    expect(JSON.stringify(fin.bundle)).not.toContain('should-not-appear')
    expect(fin.bundle.steps[1].context).toBe('Finder — Downloads')
    expect(fin.bundle.frames.some((f) => f.source === 'desktop' && f.dataUrl === 'data:image/jpeg;base64,QUJD')).toBe(true)
    // Listeners are gone: late helper events are ignored.
    expect(h.listenerCount('rec')).toBe(0)
  })

  it('finishes with what was captured when the helper dies mid-recording', async () => {
    const h = new FakeHelper()
    const events: RecorderEvent[] = []
    let svc: ReturnType<typeof createRecorderService>
    const desktop = createDesktopSource({
      helper: () => asHelper(h),
      ignorePids: () => [],
      onStopRequest: () => {},
      onLost: () => svc.sourceLost('desktop', 'helper quit')
    })
    svc = createRecorderService({ sources: { desktop }, emit: (e) => events.push(e), platform: 'darwin', settleMs: 1 })
    await svc.start({ sources: ['desktop'] })
    h.emit('rec', { event: 'rec', data: { kind: 'click', app: 'Notes', target: { role: 'AXButton', label: 'New Note' } } })
    h.emit('exit', 1, null)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'finished')).toBe(true))
    const fin = events.find((e) => e.type === 'finished')
    if (fin?.type !== 'finished') throw new Error('no bundle')
    expect(fin.bundle.steps.map((s) => s.text)).toEqual(['Click button "New Note"'])
    expect(fin.bundle.notes).toContain('helper quit')
  })

  it('notes when screenshots of Mac apps are unavailable', async () => {
    const h = new FakeHelper()
    h.perms = { accessibility: true, screenRecording: false }
    const src = createDesktopSource({ helper: () => asHelper(h), ignorePids: () => [], onStopRequest: () => {} })
    const r = await src.start(() => {})
    expect(r).toMatchObject({ ok: true, notes: [expect.stringContaining('Screen Recording')] })
    expect(await src.capture()).toBeNull()
    await src.stop()
  })
})
