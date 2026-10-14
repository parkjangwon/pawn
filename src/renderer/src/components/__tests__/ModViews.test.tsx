// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModViewModals, ModViewPanels, ModViewTabs } from '../ModViews'
import { useModsUiStore } from '../../agent/mods/uiStore'
import { getModRuntime, __resetModRuntimeForTests } from '../../agent/mods/runtime'
import { __resetModsClientForTests } from '../../agent/mods/client'
import { deriveModCapabilities, deriveModRisk } from '../../agent/mods/capabilities'
import { bridgeAllowed, buildViewDoc, runBridgeCall, viewCsp, __resetViewNonceForTests } from '../../agent/mods/views'
import type { ModsApi } from '../../agent/mods/types'
import { EN } from '../../i18n/strings'

const g = globalThis as { __viewEvents?: unknown[]; __viewErrs?: string[] }

function mod(lines: string[]): string {
  return lines.join('\n').replace(/__API__/g, '$')
}

async function load(source: string, name = 'vdemo'): Promise<void> {
  const rt = getModRuntime()
  rt.setContext({ sessionId: 's1', cwd: '/tmp' })
  await act(async () => {
    await rt.load([{ id: `${name}@1`, name, root: `/tmp/${name}`, tier: 'user', sources: [source] }])
  })
}

const viewsMod = mod([
  'export function register(on) {',
  "  on('session.start', async (__API__, e, next) => {",
  "    __API__.view.open({ id: 'p', title: 'Panel view', html: '<b>hi</b>', script: 'pawn.send(1)' })",
  "    __API__.view.open({ id: 't', title: 'Tab view', placement: 'tab', html: '<i>tab</i>' })",
  "    __API__.view.open({ id: 'm', title: 'Modal view', placement: 'modal', html: '<u>modal</u>' })",
  "    try { __API__.view.open({ id: 'x', title: 'x', html: '', placement: 'window' }) } catch (err) { globalThis.__viewErrs.push(err.message) }",
  "    try { __API__.view.open({ id: 'bad id', title: 'x', html: '' }) } catch (err) { globalThis.__viewErrs.push(err.message) }",
  '    return next(e)',
  '  })',
  "  on('view.message', { plugin: 'vdemo' }, async (__API__, e, next) => { globalThis.__viewEvents.push(e); return next(e) })",
  '}',
  '// $.store.get is named so the view may call it; $.process.run is not on the bridge list.',
  '// $.process.run'
])

beforeEach(() => {
  g.__viewEvents = []
  g.__viewErrs = []
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  __resetViewNonceForTests()
  useModsUiStore.getState().clearSessionUi()
})

afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  delete g.__viewEvents
  delete g.__viewErrs
})

describe('view document', () => {
  it('starts with a strict meta CSP and puts the nonce only on its own scripts', () => {
    const doc = buildViewDoc({ html: '<p>x</p><script>evil()</script>', script: 'go()', nonce: 'abcdefghijklmnop1234', tokens: { '--accent': '#f00', '--bad': 'x;}' }, theme: 'dark' })
    const cspAt = doc.indexOf('Content-Security-Policy')
    expect(cspAt).toBeGreaterThan(0)
    expect(cspAt).toBeLessThan(doc.indexOf('<p>x</p>'))
    expect(doc).toContain("connect-src 'none'")
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("frame-src 'none'")
    expect(doc).toContain("script-src 'nonce-abcdefghijklmnop1234'")
    expect(doc.match(/<script nonce="abcdefghijklmnop1234">/g)).toHaveLength(2)
    // The mod's raw <script> in html has no nonce, so CSP blocks it.
    expect(doc).toContain('<script>evil()</script>')
    expect(doc).toContain('--accent: #f00;')
    expect(doc).not.toContain('--bad')
    expect(doc).toContain('color-scheme: dark')
  })

  it('escapes a closing script tag inside the mod script', () => {
    const doc = buildViewDoc({ html: '', script: 'a("</script><img src=x>")', nonce: 'abcdefghijklmnop1234', tokens: {}, theme: 'light' })
    expect(doc).toContain('<\\/script><img src=x>')
  })

  it('never allows network or same-origin in the view policy', () => {
    expect(viewCsp('n')).not.toMatch(/https?:|'self'|\*/)
    expect(viewCsp('')).toContain("script-src 'unsafe-inline'")
  })
})

describe('bridge', () => {
  const api = {
    store: { get: async (k: string) => `v:${k}` },
    process: { run: async () => ({ exitCode: 0 }) },
    ui: { toast: () => undefined }
  } as unknown as ModsApi

  it('allows only listed calls that the source names', async () => {
    const declared = new Set(['$.store.get', '$.process.run'])
    expect(bridgeAllowed('store.get', declared)).toBe(true)
    expect(bridgeAllowed('process.run', declared)).toBe(false)
    expect(bridgeAllowed('ui.toast', declared)).toBe(false)
    await expect(runBridgeCall(api, declared, 'store.get', ['k'])).resolves.toBe('v:k')
    await expect(runBridgeCall(api, declared, 'process.run', [['id']])).rejects.toThrow(/not available to this view/)
    await expect(runBridgeCall(api, declared, 'ui.toast', ['x'])).rejects.toThrow(/not available to this view/)
  })
})

describe('$.view runtime and placements', () => {
  it('renders panel, tab and modal iframes sandboxed without allow-same-origin', async () => {
    render(
      <div className="app light">
        <ModViewPanels />
        <ModViewTabs />
        <ModViewModals />
      </div>
    )
    await load(viewsMod)
    expect(g.__viewErrs).toEqual(['Invalid view placement: window', 'Invalid view id: bad id'])
    const frames = await waitFor(() => {
      const f = Array.from(document.querySelectorAll('iframe.mod-view-frame'))
      expect(f).toHaveLength(3)
      return f as HTMLIFrameElement[]
    })
    for (const f of frames) {
      expect(f.getAttribute('sandbox')).toBe('allow-scripts')
      expect(f.getAttribute('data-plugin')).toBe('vdemo')
      expect(f.getAttribute('srcdoc')).toContain("connect-src 'none'")
    }
    expect(screen.getByRole('tab', { name: 'Tab view' })).toHaveAttribute('aria-selected', 'true')
    const dialog = screen.getByRole('dialog', { name: 'Modal view (from mod vdemo)' })
    expect(dialog).toHaveTextContent('mod: vdemo')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close Panel view' }))
    expect(useModsUiStore.getState().views.map((v) => v.id)).toEqual(['t'])
  })

  it('ignores messages that do not come from the view frame and routes frame sends to view.message', async () => {
    render(<ModViewPanels />)
    await load(viewsMod)
    const frame = (await waitFor(() => {
      const f = document.querySelector('iframe[data-view="p"]') as HTMLIFrameElement | null
      expect(f).not.toBeNull()
      return f
    })) as HTMLIFrameElement
    // Forged from the app window itself: ignored.
    window.dispatchEvent(new MessageEvent('message', { data: { __pawnView: 1, kind: 'send', data: 'forged' }, source: window }))
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { __pawnView: 1, kind: 'send', data: { hi: 1 } }, source: frame.contentWindow })
      )
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(g.__viewEvents).toEqual([expect.objectContaining({ plugin: 'vdemo', id: 'p', data: { hi: 1 } })])
  })

  it('refuses $.view.open when the source does not name it', async () => {
    const sneaky = mod([
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    try { __API__['vi' + 'ew']['op' + 'en']({ id: 'a', title: 'a', html: '' }) } catch (err) { globalThis.__viewErrs.push(err.message) }",
      '    return next(e)',
      '  })',
      '}'
    ])
    await load(sneaky, 'sneaky')
    expect(g.__viewErrs?.[0]).toMatch(/\$\.view\.open refused/)
    expect(useModsUiStore.getState().views).toHaveLength(0)
  })
})

describe('views capability', () => {
  it('$.view.open needs views (medium risk); post/close/list need nothing', () => {
    expect(deriveModCapabilities([], ['$.view.open']).map((c) => c.id)).toEqual(['views'])
    expect(deriveModCapabilities([], ['$.view.post', '$.view.close', '$.view.list'])).toEqual([])
    expect(deriveModRisk([], ['$.view.open'])).toBe('medium')
    expect(EN['settings.modsSection.capDesc.views']).toMatch(/no network access/)
  })
})

describe('views-demo example', () => {
  it('opens its panel and asks for views plus the bridged store/ui calls', async () => {
    const source = readFileSync(resolve(__dirname, '../../../../../examples/mods/views-demo/hooks/register.js'), 'utf8')
    render(<ModViewPanels />)
    await load(source, 'views-demo')
    await waitFor(() => expect(document.querySelector('iframe[data-view="counter"]')).not.toBeNull())
    const info = getModRuntime().getLoaded().find((m) => m.name === 'views-demo')
    const caps = deriveModCapabilities(info?.hooks || [], info?.calls || []).map((c) => c.id)
    expect(caps).toContain('views')
    expect(caps).toContain('store')
    expect(caps).not.toContain('process')
  })
})
