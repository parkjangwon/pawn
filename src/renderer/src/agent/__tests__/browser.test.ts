// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { getBrowserAgent } from '../browser'

let cacheBust: typeof import('../browser')

beforeEach(async () => {
  vi.resetModules()
  cacheBust = await import('../browser')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function apiWithBrowser(browser: Record<string, unknown>): void {
  ;(window as any).api = { platform: 'darwin', browser }
}

describe('getBrowserAgent', () => {
  it('returns null in browser-mode builds', () => {
    ;(window as any).api = { platform: 'browser' }
    expect(cacheBust.getBrowserAgent()).toBeNull()
  })

  it('returns null when the browser bridge is missing', () => {
    ;(window as any).api = { platform: 'darwin' }
    expect(cacheBust.getBrowserAgent()).toBeNull()
  })

  it('builds an agent from the IPC surface and maps results', async () => {
    const ensure = vi.fn().mockResolvedValue({})
    const navigate = vi.fn().mockResolvedValue({ url: 'https://x.dev', title: 'X' })
    const snapshot = vi.fn().mockResolvedValue({
      url: 'https://x.dev', title: 'X',
      elements: [{ ref: 'e1', role: 'link', text: 'Go', name: '', placeholder: '', value: '', href: '/go' }],
      truncated: true
    })
    const click = vi.fn().mockResolvedValue({ message: 'Clicked e1' })
    const fill = vi.fn().mockResolvedValue({ message: 'Filled' })
    const readText = vi.fn().mockResolvedValue({ text: 'page text' })
    const evalFn = vi.fn().mockResolvedValue({ result: '42' })
    const back = vi.fn().mockResolvedValue({ url: 'https://x.dev/prev' })
    const screenshot = vi.fn().mockResolvedValue({ bytes: 1234 })

    apiWithBrowser({ ensure, navigate, snapshot, click, fill, readText, eval: evalFn, back, screenshot })
    const agent = cacheBust.getBrowserAgent()
    expect(agent).not.toBeNull()

    await expect(agent!.ensure()).resolves.toEqual({})
    await expect(agent!.navigate('https://x.dev')).resolves.toEqual({ url: 'https://x.dev', title: 'X' })
    const snap = await agent!.snapshot('')
    expect(snap.elements).toHaveLength(1)
    expect(snap.truncated).toBe(true)
    await expect(agent!.click('e1', '')).resolves.toEqual({ message: 'Clicked e1' })
    await expect(agent!.fill('e1', '', 'v', true)).resolves.toEqual({ message: 'Filled' })
    await expect(agent!.readText('')).resolves.toEqual({ text: 'page text' })
    await expect(agent!.evaluate('1+1')).resolves.toEqual({ result: '42' })
    await expect(agent!.back()).resolves.toEqual({ url: 'https://x.dev/prev' })
    await expect(agent!.screenshot()).resolves.toEqual({ bytes: 1234 })
  })

  it('propagates errors and memoizes the agent', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: 'no browser' })
    const navigate = vi.fn().mockResolvedValue({ error: 'failed' })
    apiWithBrowser({ ensure, navigate })

    const agent = cacheBust.getBrowserAgent()
    await expect(agent!.ensure()).resolves.toEqual({ error: 'no browser' })
    await expect(agent!.navigate('https://x')).resolves.toEqual({ error: 'failed' })
    expect(cacheBust.getBrowserAgent()).toBe(agent)
  })
})
