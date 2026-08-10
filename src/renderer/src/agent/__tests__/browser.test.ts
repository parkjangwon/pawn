// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { getBrowserAgent } from '../browser'
import { browserOwnerKey, requireBrowser } from '../toolHandlers/browserHelpers'

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

  it('maps multi-tab methods over the IPC surface', async () => {
    const tabs = vi.fn().mockResolvedValue({
      tabs: [
        { id: 'tab-1', url: 'https://a.dev', title: 'A', loading: false, canGoBack: false, canGoForward: false },
        { id: 'tab-2', url: 'https://b.dev', title: 'B', loading: false, canGoBack: false, canGoForward: false }
      ],
      activeTabId: 'tab-2'
    })
    const tabCreate = vi.fn().mockResolvedValue({
      ok: true,
      tabs: [{ id: 'tab-3', url: '', title: '', loading: false, canGoBack: false, canGoForward: false }],
      activeTabId: 'tab-3'
    })
    const tabSwitch = vi.fn().mockResolvedValue({ ok: true })
    const tabClose = vi.fn().mockResolvedValue({ error: 'No such tab' })
    apiWithBrowser({ ensure: vi.fn().mockResolvedValue({}), tabs, tabCreate, tabSwitch, tabClose })

    const agent = cacheBust.getBrowserAgent()
    const list = await agent!.tabs()
    expect(list.activeTabId).toBe('tab-2')
    expect(list.tabs.map((t) => t.id)).toEqual(['tab-1', 'tab-2'])

    const created = await agent!.tabNew('https://c.dev')
    expect(tabCreate).toHaveBeenCalledWith('https://c.dev', undefined)
    expect(created.activeTabId).toBe('tab-3')

    await expect(agent!.tabSwitch('tab-1')).resolves.toEqual({ ok: true })
    await expect(agent!.tabClose('tab-1')).resolves.toEqual({ ok: false, error: 'No such tab' })
  })

  it('propagates tab errors from the IPC surface', async () => {
    const tabs = vi.fn().mockResolvedValue({ error: 'no browser' })
    apiWithBrowser({ ensure: vi.fn().mockResolvedValue({}), tabs })
    const agent = cacheBust.getBrowserAgent()
    await expect(agent!.tabs()).resolves.toEqual({ tabs: [], activeTabId: null, error: 'no browser' })
  })

  it('binds owner-key agents: per-owner memoization and owner pass-through', async () => {
    const navigate = vi.fn().mockResolvedValue({ url: 'https://x.dev', title: 'X' })
    const back = vi.fn().mockResolvedValue({ url: 'https://x.dev/prev' })
    const ensure = vi.fn().mockResolvedValue({})
    apiWithBrowser({ ensure, navigate, back })

    const parent = cacheBust.getBrowserAgent('session:s1')
    const sub = cacheBust.getBrowserAgent('subagent:r1')
    expect(parent).not.toBeNull()
    expect(sub).not.toBeNull()
    // Different owners → different agents; same owner → memoized.
    expect(parent).not.toBe(sub)
    expect(cacheBust.getBrowserAgent('subagent:r1')).toBe(sub)

    await parent!.navigate('https://x.dev')
    await sub!.back()
    expect(navigate).toHaveBeenCalledWith('https://x.dev', 'session:s1')
    expect(back).toHaveBeenCalledWith('subagent:r1')
  })

  it('derives browser owner keys from the tool execution context', () => {
    expect(browserOwnerKey({ subagent: true, subagentRunId: 'r1', sessionId: 's1' })).toBe('subagent:r1')
    expect(browserOwnerKey({ sessionId: 's1' })).toBe('session:s1')
    expect(browserOwnerKey({ subagent: true })).toBeUndefined()
    expect(browserOwnerKey({})).toBeUndefined()
    expect(browserOwnerKey(undefined)).toBeUndefined()
  })

  it('opens the browser panel when a browser tool runs', async () => {
    const openSpy = vi.fn()
    ;(window as any).__openRightPanelTab = openSpy
    apiWithBrowser({ ensure: vi.fn().mockResolvedValue({}) })

    const res = await requireBrowser({ sessionId: 's1' })
    expect('error' in res).toBe(false)
    expect(openSpy).toHaveBeenCalledWith('browser')
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
