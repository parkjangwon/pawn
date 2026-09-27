// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildBrowserRecorderScript, buildBrowserRecorderStopScript, parseRecorderMessage } from '../recorder/browserScript'

// Runs in jsdom; main's tsconfig has no DOM lib, so DOM globals are reached untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const W: any = globalThis
const document = W.document
const window = W.window
const { MouseEvent, KeyboardEvent, Event } = W
const NONCE = 'a1b2c3d4e5f6a7b8c9d0'

function install(allowUntrusted = true): { lines: () => Array<Record<string, unknown>> } {
  const seen: unknown[] = []
  vi.spyOn(console, 'debug').mockImplementation((m: unknown) => void seen.push(m))
  if (!(globalThis as { CSS?: unknown }).CSS) (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/[^\w-]/g, '\\$&') }
  // eslint-disable-next-line no-eval
  window.eval(buildBrowserRecorderScript(NONCE, { allowUntrusted }))
  return { lines: () => seen.map((m) => parseRecorderMessage(m, NONCE)).filter((x): x is Record<string, unknown> => !!x) }
}

beforeEach(() => {
  window.eval(buildBrowserRecorderStopScript())
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = `
    <form id="f" aria-label="Expense">
      <label for="amt">Amount</label><input id="amt" name="amount" type="text">
      <label>Password <input id="pw" name="pw" type="password"></label>
      <input id="otp" name="code" autocomplete="one-time-code">
      <select id="cat" name="category"><option value="t">Travel</option><option value="m">Meals</option></select>
      <label><input id="bill" type="checkbox"> Billable</label>
      <button id="go" type="button"><span id="inner">Submit expense</span></button>
      <button id="send" type="submit">Send</button>
      <a id="lnk" href="https://exp.co/reports">Reports</a>
      <div role="button" id="fancy" aria-label="More options"><svg></svg></div>
    </form>`
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const type = (el: any, value: string): void => {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('browser recorder script', () => {
  it('reports clicks on the actionable ancestor with a semantic description', () => {
    const r = install()
    document.getElementById('inner').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    document.getElementById('fancy').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const [a, b] = r.lines()
    expect(a).toMatchObject({ kind: 'click', button: 'left', target: { tag: 'button', label: 'Submit expense', id: 'go', selector: '#go' } })
    expect(b).toMatchObject({ kind: 'click', target: { role: 'button', label: 'More options' } })
  })

  it('debounces typing into one value and flushes on Enter', async () => {
    vi.useFakeTimers()
    const r = install()
    const amt = document.getElementById('amt')
    type(amt, '4')
    type(amt, '42')
    expect(r.lines()).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    expect(r.lines()).toEqual([expect.objectContaining({ kind: 'input', value: '42', target: expect.objectContaining({ label: 'Amount', name: 'amount' }) })])
    type(amt, '42.5')
    amt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const lines = r.lines()
    expect(lines[1]).toMatchObject({ kind: 'input', value: '42.5' })
    expect(lines[2]).toMatchObject({ kind: 'key', key: 'Enter' })
  })

  it('never reads password or one-time-code values', async () => {
    vi.useFakeTimers()
    const r = install()
    type(document.getElementById('pw'), 'hunter2')
    type(document.getElementById('otp'), '123456')
    vi.advanceTimersByTime(1000)
    const out = r.lines()
    expect(out).toHaveLength(2)
    for (const l of out) {
      expect(l.secret).toBe(true)
      expect(l.value).toBeUndefined()
    }
    expect(JSON.stringify(out)).not.toMatch(/hunter2|123456/)
  })

  it('reports selects by option text, checkbox state, submits and shortcuts', async () => {
    const r = install()
    const cat = document.getElementById('cat')
    cat.selectedIndex = 1
    cat.dispatchEvent(new Event('change', { bubbles: true }))
    const bill = document.getElementById('bill')
    // The click itself toggles the box (false → true).
    bill.checked = false
    bill.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.getElementById('f').dispatchEvent(new Event('submit', { bubbles: true }))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    await new Promise((res) => setTimeout(res, 5))
    const kinds = r.lines()
    expect(kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'select', value: 'Meals' }),
        expect.objectContaining({ kind: 'click', checked: true, target: expect.objectContaining({ inputType: 'checkbox' }) }),
        expect.objectContaining({ kind: 'submit', target: expect.objectContaining({ label: 'Expense' }) }),
        expect.objectContaining({ kind: 'key', key: 'cmd+s' })
      ])
    )
  })

  it('ignores synthetic (untrusted) events such as the agent clicking', () => {
    const r = install(false)
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // A synthetic click on a submit button: the browser's own submit must not count either.
    ;(document.getElementById('send')).click()
    type(document.getElementById('amt'), 'x')
    expect(r.lines()).toHaveLength(0)
  })

  it('stops cleanly and can be re-armed without double listeners', () => {
    const r = install()
    window.eval(buildBrowserRecorderScript(NONCE, { allowUntrusted: true }))
    document.getElementById('lnk').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(r.lines()).toHaveLength(1)
    expect(r.lines()[0]).toMatchObject({ target: { tag: 'a', href: 'https://exp.co/reports', label: 'Reports' } })
    window.eval(buildBrowserRecorderStopScript())
    document.getElementById('lnk').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(r.lines()).toHaveLength(1)
  })
})
