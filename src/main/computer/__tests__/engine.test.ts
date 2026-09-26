import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import {
  ComputerEngine,
  HIGH_RES_POLICY,
  STANDARD_POLICY,
  fitSize,
  modifiersArg,
  pointArg,
  rewriteOutline,
  toGlobal,
  toImage,
  type CuaLike,
  type Frame
} from '../engine'
import { CuaHelper, findHelper, helperCandidates, timeoutFor } from '../cuaHelper'

/** Records helper calls and answers from a table. */
function mockCua(answers: Record<string, unknown | ((p: Record<string, unknown>) => unknown)> = {}): CuaLike & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = []
  return {
    calls,
    async call(method: string, params: Record<string, unknown> = {}) {
      calls.push([method, params])
      const a = answers[method]
      if (a instanceof Error) throw a
      return (typeof a === 'function' ? (a as (p: Record<string, unknown>) => unknown)(params) : a ?? { ok: true }) as never
    }
  }
}

const DISPLAYS = {
  displays: [
    { id: 1, frame: { x: 0, y: 0, width: 1728, height: 1117 }, scale: 2, name: 'Built-in', primary: true, pixelWidth: 3456, pixelHeight: 2234 },
    { id: 2, frame: { x: -1920, y: -200, width: 1920, height: 1080 }, scale: 1, name: 'External', primary: false, pixelWidth: 1920, pixelHeight: 1080 }
  ]
}

function shot(region = { x: 0, y: 0, width: 1728, height: 1117 }, width = 1568, height = 1013, displayId = 1) {
  return {
    data: 'AAAA',
    mime: 'image/jpeg',
    width,
    height,
    region,
    display: { id: displayId, frame: region, scale: 2, name: 'Built-in', primary: displayId === 1 },
    cursor: { x: 864, y: 558 }
  }
}

describe('coordinate math', () => {
  const frame: Frame = { region: { x: 0, y: 0, width: 1728, height: 1117 }, width: 1568, height: 1013 }

  it('fits screenshots to the long-edge and pixel budgets', () => {
    expect(fitSize(1728, 1117, STANDARD_POLICY)).toEqual({ width: 1333, height: 862 })
    expect(fitSize(1728, 1117, { maxLongEdge: 1568, maxPixels: 0 })).toEqual({ width: 1568, height: 1013 })
    expect(fitSize(800, 600, HIGH_RES_POLICY)).toEqual({ width: 800, height: 600 })
  })

  it('maps image pixels to screen points and back', () => {
    const g = toGlobal(frame, 784, 506)
    expect(g.x).toBeCloseTo(864, 0)
    expect(g.y).toBeCloseTo(558, 0)
    expect(toImage(frame, g.x, g.y)).toEqual({ x: 784, y: 506 })
  })

  it('handles secondary displays with negative origins', () => {
    const ext: Frame = { region: { x: -1920, y: -200, width: 1920, height: 1080 }, width: 1568, height: 882 }
    const g = toGlobal(ext, 0, 0)
    expect(g).toEqual({ x: -1920, y: -200 })
    expect(toImage(ext, -960, 340)).toEqual({ x: 784, y: 441 })
  })

  it('rewrites UI outline positions into screenshot pixels', () => {
    const out = rewriteOutline('[5] button "7" @(448,774 48x48)\nwindow @(529,767 230x408)', frame)
    expect(out).toBe('[5] button "7" @(407,702 44x44)\nwindow @(480,696 209x370)')
  })

  it('parses points and modifiers in every shape the models use', () => {
    expect(pointArg({ coordinate: [10, 20] })).toEqual([10, 20])
    expect(pointArg({ coordinate: { x: 1, y: 2 } })).toEqual([1, 2])
    expect(pointArg({ x: '3', y: 4 })).toEqual([3, 4])
    expect(pointArg({})).toBeUndefined()
    expect(modifiersArg('ctrl+shift')).toEqual(['ctrl', 'shift'])
    expect(modifiersArg(['cmd'])).toEqual(['cmd'])
    expect(modifiersArg(undefined)).toEqual([])
  })
})

describe('ComputerEngine', () => {
  it('establishes a mapping from the primary display before any screenshot', async () => {
    const cua = mockCua({ displays: DISPLAYS })
    const eng = new ComputerEngine(cua)
    await eng.execute('left_click', { coordinate: [666, 430] })
    const [method, params] = cua.calls.find((c) => c[0] === 'click')!
    expect(method).toBe('click')
    // 1728/1333 ≈ 1.2963 points per pixel
    expect(params.x as number).toBeCloseTo(666 * (1728 / 1333), 1)
    expect(params.y as number).toBeCloseTo(430 * (1117 / 862), 1)
    expect(params).toMatchObject({ button: 'left', clicks: 1, modifiers: [] })
  })

  it('uses the last screenshot as the coordinate space, including the other display', async () => {
    const cua = mockCua({ screenshot: shot({ x: -1920, y: -200, width: 1920, height: 1080 }, 1568, 882, 2) })
    const eng = new ComputerEngine(cua)
    const res = await eng.execute('screenshot', { display_id: 2 })
    expect(res.image?.dataUrl).toBe('data:image/jpeg;base64,AAAA')
    expect(res.text).toContain('1568x882')
    await eng.execute('double_click', { coordinate: [784, 441], text: 'shift' })
    const click = cua.calls.find((c) => c[0] === 'click')![1]
    expect(click.x as number).toBeCloseTo(-960, 0)
    expect(click.y as number).toBeCloseTo(340, 0)
    expect(click).toMatchObject({ clicks: 2, modifiers: ['shift'] })
  })

  it('zooms by mapping the image-space region to screen points without changing the mapping', async () => {
    const cua = mockCua({ screenshot: shot(), zoom: shot({ x: 0, y: 0, width: 110.2, height: 55.1 }, 1568, 784) })
    const eng = new ComputerEngine(cua)
    await eng.execute('screenshot')
    const before = { ...eng.frame! }
    await eng.execute('zoom', { region: [0, 0, 100, 50] })
    const zoom = cua.calls.find((c) => c[0] === 'zoom')![1]
    expect((zoom.region as number[]).map((v) => Math.round(v))).toEqual([0, 0, 110, 55])
    expect(eng.frame).toEqual(before)
  })

  it('presses elements through the accessibility tree instead of pixels', async () => {
    const cua = mockCua({ displays: DISPLAYS, ui_action: { role: 'AXButton', label: 'Save', performed: 'AXPress' } })
    const eng = new ComputerEngine(cua)
    const res = await eng.execute('click', { element: 42 })
    expect(cua.calls.at(-1)).toEqual(['ui_action', { element: 42, action: 'press' }])
    expect(res.text).toContain('Pressed element [42]')
    await eng.execute('right_click', { element: 42 })
    expect(cua.calls.at(-1)).toEqual(['ui_action', { element: 42, action: 'show_menu' }])
  })

  it('maps Claude computer-tool inputs (scroll, key repeat, hold_key, wait, drag)', async () => {
    const cua = mockCua({ displays: DISPLAYS })
    const eng = new ComputerEngine(cua)
    await eng.execute('scroll', { coordinate: [10, 10], scroll_direction: 'down', scroll_amount: 5, text: 'ctrl' })
    expect(cua.calls.at(-1)![1]).toMatchObject({ direction: 'down', amount: 5, modifiers: ['ctrl'] })
    await eng.execute('key', { text: 'Tab', repeat: 4 })
    expect(cua.calls.at(-1)).toEqual(['key', { key: 'Tab', repeat: 4 }])
    await eng.execute('hold_key', { text: 'shift', duration: 1.5 })
    expect(cua.calls.at(-1)).toEqual(['hold_key', { key: 'shift', durationMs: 1500 }])
    await eng.execute('wait', { duration: 2 })
    expect(cua.calls.at(-1)).toEqual(['wait', { ms: 2000 }])
    await eng.execute('left_click_drag', { start_coordinate: [0, 0], coordinate: [1333, 862] })
    const drag = cua.calls.at(-1)![1]
    expect((drag.path as number[][]).map((p) => p.map(Math.round))).toEqual([[0, 0], [1728, 1117]])
  })

  it('reports the cursor in screenshot pixels', async () => {
    const cua = mockCua({ displays: DISPLAYS, cursor: { x: 864, y: 558.5 } })
    const res = await new ComputerEngine(cua).execute('cursor_position')
    expect(res.text).toBe('X=667, Y=431')
  })

  it('falls back to OCR when the accessibility tree has no match', async () => {
    const cua = mockCua({
      displays: DISPLAYS,
      ui_find: { text: 'App: X', matches: [] },
      find_text: { matches: [{ text: 'Submit order', center: { x: 864, y: 558 }, frame: { x: 800, y: 550, width: 128, height: 16 } }] }
    })
    const res = await new ComputerEngine(cua).execute('find', { query: 'submit' })
    expect(res.ok).toBe(true)
    expect(res.text).toContain('"Submit order" @(667,431)')
  })

  it('rejects unknown actions and missing arguments with clear errors', async () => {
    const eng = new ComputerEngine(mockCua({ displays: DISPLAYS }))
    await expect(eng.execute('teleport')).rejects.toThrow(/Unknown computer action/)
    await expect(eng.execute('zoom', {})).rejects.toThrow(/region/)
    await expect(eng.execute('type', {})).rejects.toThrow(/text is required/)
  })

  it('attaches a screenshot after an action when asked', async () => {
    const cua = mockCua({ displays: DISPLAYS, screenshot: shot() })
    const res = await new ComputerEngine(cua).execute('key', { key: 'Return', return_screenshot: true, settle_ms: 0 })
    expect(res.image?.width).toBe(1568)
    expect(res.text).toContain('Pressed Return')
  })
})

describe('CuaHelper protocol', () => {
  /** Fake helper process speaking JSON Lines. */
  function fakeProc(handler: (req: { id: number; method: string; params: unknown }) => unknown) {
    const proc = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; exitCode: number | null; kill: () => void }
    proc.stdin = new PassThrough()
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    proc.exitCode = null
    proc.kill = () => {
      proc.exitCode = 0
      proc.emit('exit', 0, null)
    }
    let buf = ''
    proc.stdin.on('data', (c: Buffer) => {
      buf += c.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, i))
        buf = buf.slice(i + 1)
        const out = handler(req)
        if (out !== undefined) proc.stdout.write(`${JSON.stringify(out)}\n`)
      }
    })
    setTimeout(() => proc.stdout.write('{"event":"ready","version":"test"}\n'), 5)
    return proc
  }

  it('correlates responses, surfaces errors, and emits events', async () => {
    const proc = fakeProc((req) => {
      if (req.method === 'boom') return { id: req.id, error: { code: 'no_accessibility', message: 'grant it' } }
      if (req.method === 'abort') {
        setTimeout(() => proc.stdout.write('{"event":"user_abort"}\n'), 1)
        return { id: req.id, result: {} }
      }
      return { id: req.id, result: { echo: req.method } }
    })
    const h = new CuaHelper({ path: '/fake', spawn: () => proc as never })
    await expect(h.call('ping')).resolves.toEqual({ echo: 'ping' })
    await expect(h.call('boom')).rejects.toMatchObject({ code: 'no_accessibility', message: 'grant it' })
    const aborted = new Promise((r) => h.once('user_abort', r))
    await h.call('abort')
    await expect(aborted).resolves.toBeTruthy()
    h.dispose()
  })

  it('times out stuck calls and rejects pending calls when the helper dies', async () => {
    const proc = fakeProc((req) => (req.method === 'hang' ? undefined : { id: req.id, result: {} }))
    const h = new CuaHelper({ path: '/fake', spawn: () => proc as never })
    await expect(h.call('hang', {}, 50)).rejects.toMatchObject({ code: 'timeout' })
    const pending = h.call('hang', {}, 5000)
    await new Promise((r) => setTimeout(r, 10))
    proc.kill()
    await expect(pending).rejects.toMatchObject({ code: 'crashed' })
  })

  it('reports unavailable without a binary and resolves helper paths', async () => {
    const h = new CuaHelper({ path: null })
    expect(h.isAvailable).toBe(false)
    await expect(h.call('ping')).rejects.toMatchObject({ code: 'unavailable' })
    const c = helperCandidates({ env: { PAWN_CUA_PATH: '/x/pawn-cua' }, resourcesPath: '/App/Resources', cwd: '/repo' })
    expect(c[0]).toBe('/x/pawn-cua')
    expect(c).toContain('/App/Resources/bin/pawn-cua')
    expect(c).toContain('/repo/native/macos/build/pawn-cua')
    expect(findHelper(c, (p) => p === '/repo/native/macos/build/pawn-cua')).toBe('/repo/native/macos/build/pawn-cua')
  })

  it('scales timeouts with the action length', () => {
    expect(timeoutFor('wait', { ms: 60_000 })).toBe(65_000)
    expect(timeoutFor('type', { text: 'x'.repeat(1000) })).toBe(35_000)
    expect(timeoutFor('click')).toBe(12_000)
  })
})
