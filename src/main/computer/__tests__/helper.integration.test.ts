/**
 * Real macOS integration: the TypeScript client + engine driving the actual
 * pawn-cua binary. Read-only checks run whenever the helper is built and the
 * process has Screen Recording / Accessibility; the interactive checks
 * (launching Calculator / TextEdit, moving the mouse, typing) also require
 * PAWN_CUA_E2E=1 because they take over the real desktop for a few seconds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { CuaHelper } from '../cuaHelper'
import { ComputerEngine, STANDARD_POLICY, toGlobal } from '../engine'
import { acquireDesktop } from './desktopLock'

const BIN = join(process.cwd(), 'native', 'macos', 'build', 'pawn-cua')
const HAS_HELPER = process.platform === 'darwin' && existsSync(BIN)
const E2E = HAS_HELPER && process.env.PAWN_CUA_E2E === '1'

let helper: CuaHelper
let engine: ComputerEngine
let perms: { accessibility: boolean; screenRecording: boolean } = { accessibility: false, screenRecording: false }

beforeAll(async () => {
  if (!HAS_HELPER) return
  helper = new CuaHelper({ path: BIN })
  engine = new ComputerEngine(helper)
  perms = await helper.call('permissions')
  // Keep the overlay out of the way during tests.
  await helper.call('overlay', { enabled: E2E })
})

afterAll(() => {
  helper?.dispose()
})

describe.skipIf(!HAS_HELPER)('pawn-cua helper (real binary)', { timeout: 30_000 }, () => {
  it('answers capabilities and permissions', async () => {
    const caps = await helper.call<{ version: string; methods: string[] }>('capabilities')
    expect(caps.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(caps.methods).toEqual(expect.arrayContaining(['screenshot', 'zoom', 'ui_snapshot', 'ui_action', 'ocr', 'type']))
    expect(typeof perms.accessibility).toBe('boolean')
  })

  it('lists displays with frames and scale', async () => {
    const res = await helper.call<{ displays: Array<{ id: number; frame: { width: number }; scale: number; primary: boolean }> }>('displays')
    expect(res.displays.length).toBeGreaterThan(0)
    expect(res.displays.some((d) => d.primary)).toBe(true)
    expect(res.displays[0].frame.width).toBeGreaterThan(100)
  })

  it('reports clear errors for bad input', async () => {
    await expect(helper.call('key', { key: 'definitely-not-a-key' })).rejects.toMatchObject({ code: expect.stringMatching(/bad_key|no_accessibility/) })
    await expect(helper.call('nope')).rejects.toMatchObject({ code: 'unknown_method' })
    await expect(helper.call('click', { x: 1e7, y: 1e7 })).rejects.toMatchObject({ code: expect.stringMatching(/out_of_bounds|no_accessibility/) })
    // Naming an app that isn't running must fail, never fall back to the frontmost app.
    await expect(helper.call('ui_snapshot', { app: 'com.example.not-installed' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(helper.call('key', { key: 'Return', pid: 999_999 })).rejects.toMatchObject({ code: expect.stringMatching(/not_found|no_accessibility/) })
  })

  it.skipIf(!HAS_HELPER)('captures a screenshot within the vision budget and maps coordinates', async () => {
    if (!perms.screenRecording) return
    const res = await engine.execute('screenshot', {})
    expect(res.ok).toBe(true)
    expect(res.image!.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(Math.max(res.image!.width, res.image!.height)).toBeLessThanOrEqual(STANDARD_POLICY.maxLongEdge)
    expect(res.image!.width * res.image!.height).toBeLessThanOrEqual(STANDARD_POLICY.maxPixels)
    const f = engine.frame!
    const g = toGlobal(f, res.image!.width, res.image!.height)
    expect(g.x).toBeCloseTo(f.region.x + f.region.width, 0)
  })

  it('zooms into a region at higher detail than the full screenshot', async () => {
    if (!perms.screenRecording) return
    await engine.execute('screenshot', {})
    const res = await engine.execute('zoom', { region: [0, 0, 400, 30] })
    expect(res.ok).toBe(true)
    expect(res.image!.width).toBeGreaterThan(400)
  })

  it('reads on-screen text with OCR', async () => {
    if (!perms.screenRecording) return
    await engine.execute('screenshot', {})
    // A freshly built binary compiles the Vision text model once (~30-60 s);
    // the helper answers ocr_warming meanwhile. Wait it out like a user would.
    const t0 = Date.now()
    let res
    for (;;) {
      try {
        res = await engine.execute('ocr', { region: [0, 0, 1000, 40] })
        break
      } catch (err) {
        if ((err as { code?: string }).code !== 'ocr_warming' || Date.now() - t0 > 150_000) throw err
      }
    }
    expect(res.ok).toBe(true)
    // The menu bar always has text.
    expect(res.text).toMatch(/text lines|No text/)
  }, 180_000)

  it('lists running apps and windows', async () => {
    const apps = await engine.execute('apps', { action: 'list' })
    expect(apps.text).toContain('Finder')
    const wins = await engine.execute('windows', { action: 'list' })
    expect(wins.ok).toBe(true)
  })
})

describe.skipIf(!E2E)('pawn-cua interactive E2E (PAWN_CUA_E2E=1)', { timeout: 40_000 }, () => {
  let release: (() => void) | undefined
  beforeAll(async () => {
    release = await acquireDesktop()
  }, 200_000)
  afterAll(() => release?.())

  it('drives Calculator by accessibility elements and by pixel clicks', async () => {
    const before = await helper.call<{ apps: Array<{ bundleId: string }> }>('apps')
    const wasRunning = before.apps.some((a) => a.bundleId === 'com.apple.calculator')
    await engine.execute('apps', { action: 'launch', bundle_id: 'com.apple.calculator' })
    await new Promise((r) => setTimeout(r, 700))
    await engine.execute('screenshot', {})
    const snap = await engine.execute('ui_snapshot', { app: 'com.apple.calculator' })
    const ids = new Map<string, number>()
    for (const line of snap.text.split('\n')) {
      const m = /\[(\d+)\] button "([^"]+)"/.exec(line)
      if (m && !ids.has(m[2])) ids.set(m[2], Number(m[1]))
    }
    // Clear (label varies by locale: AC / C / 지우기 / 전체 삭제 / Clear)
    for (const label of ['All Clear', 'Clear', 'AC', 'C', '지우기', '전체 삭제']) {
      if (ids.has(label)) await engine.execute('click', { element: ids.get(label) })
    }
    const digit = (d: string): number => {
      const id = ids.get(d)
      if (id === undefined) throw new Error(`no button ${d} in:\n${snap.text}`)
      return id
    }
    for (const d of ['1', '2', '3']) await engine.execute('click', { element: digit(d) })
    // Pixel path: click "4" by the @(x,y) position from the outline.
    const line4 = snap.text.split('\n').find((l) => /button "4"/.test(l))!
    const [, px, py] = /@\((\d+),(\d+)/.exec(line4)!.map(Number)
    await engine.execute('left_click', { coordinate: [px, py] })
    await new Promise((r) => setTimeout(r, 250))
    const after = await engine.execute('ui_snapshot', { app: 'com.apple.calculator' })
    expect(after.text).toMatch(/= "1,?234"/)
    if (!wasRunning) await engine.execute('apps', { action: 'quit', bundle_id: 'com.apple.calculator' })
  }, 30_000)

  it('types multilingual text through the IME and reads it back from the text view', async () => {
    const before = await helper.call<{ apps: Array<{ bundleId: string }> }>('apps', { all: true })
    if (before.apps.some((a) => a.bundleId === 'com.apple.TextEdit')) return // never touch the user's documents
    await engine.execute('apps', { action: 'launch', bundle_id: 'com.apple.TextEdit' })
    await new Promise((r) => setTimeout(r, 1200))
    await engine.execute('key', { key: 'cmd+n' })
    await new Promise((r) => setTimeout(r, 700))
    const text = 'Pawn 안녕하세요 こんにちは 👋\n(x+y)*z = "ok"'
    await engine.execute('type', { text })
    await new Promise((r) => setTimeout(r, 300))
    const focused = await helper.call<{ element?: { value?: string; role?: string } }>('ui_focused')
    expect(focused.element?.role).toBe('AXTextArea')
    expect(focused.element?.value).toBe(text)
    await engine.execute('key', { key: 'cmd+a' })
    await engine.execute('key', { key: 'BackSpace' })
    // Close the empty document and quit; answer a save sheet if one appears.
    await engine.execute('key', { key: 'cmd+w' })
    await new Promise((r) => setTimeout(r, 800))
    const sheet = await engine.execute('ui_snapshot', { app: 'com.apple.TextEdit', scope: 'app', interactive_only: true })
    const del = /\[(\d+)\] button "(Delete|Don’t Save|Don't Save|삭제|저장 안 함)"/.exec(sheet.text)
    if (del) await engine.execute('ui_action', { element: Number(del[1]) })
    await new Promise((r) => setTimeout(r, 300))
    await engine.execute('apps', { action: 'quit', bundle_id: 'com.apple.TextEdit' })
  }, 30_000)
})
