// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ModThemeStyles from '../ModThemeStyles'
import { ModSidebarSlots } from '../ModSlots'
import { useModsUiStore } from '../../agent/mods/uiStore'
import { getModRuntime, __resetModRuntimeForTests } from '../../agent/mods/runtime'
import { __resetModsClientForTests } from '../../agent/mods/client'
import { deriveModCapabilities, deriveModRisk } from '../../agent/mods/capabilities'
import { buildModThemeCss, sanitizeCss, sanitizeVars, type ModThemeEntry } from '../../agent/mods/theme'
import { EN } from '../../i18n/strings'

const g = globalThis as { __themeErrs?: string[] }

function mod(lines: string[]): string {
  return lines.join('\n').replace(/__API__/g, '$')
}

async function load(source: string, name = 'tdemo'): Promise<void> {
  const rt = getModRuntime()
  rt.setContext({ sessionId: 's1', cwd: '/tmp' })
  await act(async () => {
    await rt.load([{ id: `${name}@1`, name, root: `/tmp/${name}`, tier: 'user', sources: [source] }])
  })
}

function styleText(): string {
  return document.querySelector('style[data-mod-theme]')?.textContent || ''
}

beforeEach(() => {
  g.__themeErrs = []
  localStorage.clear()
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  useModsUiStore.getState().clearSessionUi()
  useModsUiStore.setState({ themeOff: [] })
})

afterEach(() => {
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  delete g.__themeErrs
})

describe('theme sanitizers', () => {
  it('accepts custom properties and adds the -- prefix', () => {
    expect(sanitizeVars({ '--accent': '#123456', primary: 'rgb(1 2 3)' })).toEqual({
      '--accent': '#123456',
      '--primary': 'rgb(1 2 3)'
    })
  })

  it.each([
    [{ color: 'red; } body { x: y' }],
    [{ '--bg': 'url(https://evil.example/x.png)' }],
    [{ 'not a var!': 'red' }],
    [{ '--x': '' }],
    [['--x']]
  ])('refuses %j', (input) => {
    expect(() => sanitizeVars(input)).toThrow()
  })

  it.each([
    '@import "https://evil.example/a.css";',
    '.x { background: url(https://evil.example/leak) }',
    '.x { color: red } } body { display: none',
    '</style><script>alert(1)</script>',
    '@scope (body) { * { display: none } }',
    '.x { content: "\\75 rl(" }',
    ':scope { position: fixed; inset: 0 }'
  ])('refuses css %s', (css) => {
    expect(() => sanitizeCss(css)).toThrow()
  })

  it('keeps a plain sheet', () => {
    expect(sanitizeCss('.a { color: var(--accent); }')).toBe('.a { color: var(--accent); }')
  })
})

describe('buildModThemeCss', () => {
  const entries: ModThemeEntry[] = [
    { plugin: 'p', id: 'l', kind: 'vars' as const, mode: 'light' as const, vars: { '--accent': '#111' } },
    { plugin: 'p', id: 'a', kind: 'vars' as const, mode: 'all' as const, vars: { '--x': '1px' } },
    { plugin: 'q', id: 'c', kind: 'css' as const, mode: 'all' as const, css: '.t { color: red }' }
  ]

  it('puts vars on the app root per mode and scopes sheets to the mod', () => {
    const css = buildModThemeCss(entries, [])
    expect(css).toContain('.app.app.light:not(.mods-trusted) {\n  --accent: #111;\n}')
    expect(css).toContain('.app.app:not(.mods-trusted) {\n  --x: 1px;\n}')
    expect(css).toContain('@scope ([data-plugin="q"]) {\n.t { color: red }\n}')
  })

  it('drops mods the user switched off (case-insensitive)', () => {
    const css = buildModThemeCss(entries, ['P'])
    expect(css).not.toContain('--accent')
    expect(css).toContain('data-plugin="q"')
  })
})

describe('$.theme runtime', () => {
  const themed = mod([
    'export function register(on) {',
    "  on('session.start', async (__API__, e, next) => {",
    "    __API__.theme.vars({ id: 'pal', mode: 'dark', vars: { '--accent': '#ff8800' } })",
    "    __API__.theme.css({ id: 'side', css: '.mod-slot-sidebar-name { color: var(--accent) }' })",
    "    try { __API__.theme.vars({ id: 'bad', vars: { '--x': 'url(x)' } }) } catch (err) { globalThis.__themeErrs.push(String(err.message)) }",
    "    try { __API__.theme.css({ id: 'bad id!', css: '' }) } catch (err) { globalThis.__themeErrs.push(String(err.message)) }",
    '    return next(e)',
    '  })',
    '}'
  ])

  it('renders a style tag, refuses bad input, and toggles off per mod', async () => {
    render(<ModThemeStyles />)
    await load(themed)
    await waitFor(() => expect(styleText()).toContain('.app.app.dark:not(.mods-trusted) {\n  --accent: #ff8800;\n}'))
    expect(styleText()).toContain('@scope ([data-plugin="tdemo"])')
    expect(g.__themeErrs).toEqual([expect.stringMatching(/Refused value/), 'Invalid theme id: bad id!'])
    expect(useModsUiStore.getState().themes.map((t) => t.id).sort()).toEqual(['pal', 'side'])

    act(() => useModsUiStore.getState().setThemeEnabled('tdemo', false))
    expect(document.querySelector('style[data-mod-theme]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('pawn.mods.themeOff') || '[]')).toEqual(['tdemo'])
    act(() => useModsUiStore.getState().setThemeEnabled('tdemo', true))
    expect(styleText()).toContain('--accent: #ff8800')
  })

  it('refuses a $.theme call that is not written in the source', async () => {
    const sneaky = mod([
      'export function register(on) {',
      "  on('session.start', async (__API__, e, next) => {",
      "    const t = __API__['th' + 'eme']",
      "    try { t['va' + 'rs']({ id: 'x', vars: { '--a': 'red' } }) } catch (err) { globalThis.__themeErrs.push(String(err.message)) }",
      '    return next(e)',
      '  })',
      '}'
    ])
    await load(sneaky, 'sneaky')
    expect(g.__themeErrs?.[0]).toMatch(/\$\.theme\.vars refused/)
    expect(useModsUiStore.getState().themes).toHaveLength(0)
  })

  it('clears themes when the runtime is cleared', async () => {
    await load(themed)
    expect(useModsUiStore.getState().themes.length).toBe(2)
    useModsUiStore.getState().clearSessionUi()
    expect(useModsUiStore.getState().themes).toHaveLength(0)
  })
})

describe('theme capability', () => {
  it('$.theme.vars and $.theme.css need the theme capability; remove/list do not', () => {
    expect(deriveModCapabilities([], ['$.theme.vars']).map((c) => c.id)).toEqual(['theme'])
    expect(deriveModCapabilities([], ['$.theme.css']).map((c) => c.id)).toEqual(['theme'])
    expect(deriveModCapabilities([], ['$.theme.remove', '$.theme.list'])).toEqual([])
    expect(deriveModRisk([], ['$.theme.vars'])).toBe('medium')
    expect(deriveModRisk([], ['$.theme.css'])).toBe('medium')
    expect(EN['settings.modsSection.cap.theme']).toBeTruthy()
    expect(EN['settings.modsSection.capDesc.theme']).toMatch(/switch its theme off/)
  })
})

describe('theming-demo example', () => {
  it('applies light and dark palettes plus a scoped sheet and swaps on press', async () => {
    const source = readFileSync(
      resolve(__dirname, '../../../../../examples/mods/theming-demo/hooks/register.js'),
      'utf8'
    )
    render(
      <>
        <ModThemeStyles />
        <ModSidebarSlots />
      </>
    )
    await load(source, 'theming-demo')
    await waitFor(() => expect(styleText()).toContain('--accent: #2f6b3a'))
    expect(styleText()).toContain('.app.app.dark')
    expect(styleText()).toContain('@scope ([data-plugin="theming-demo"])')
    expect(document.querySelector('.mod-slot-sidebar[data-plugin="theming-demo"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Swap palette' }))
    await waitFor(() => expect(styleText()).toContain('--accent: #6b3fa0'))
    const info = getModRuntime().getLoaded().find((m) => m.name === 'theming-demo')
    expect(deriveModCapabilities(info?.hooks || [], info?.calls || []).map((c) => c.id)).toEqual([
      'ui',
      'sidebar',
      'theme'
    ])
  })
})

describe('trusted surfaces ignore mod theme vars', () => {
  const globalCss = readFileSync(resolve(__dirname, '../../styles/global.css'), 'utf8')

  it('global.css re-declares default tokens on .mods-trusted for root, light and dark', () => {
    expect(globalCss).toMatch(/:root,\s*\.mods-trusted \{/)
    expect(globalCss).toMatch(/\.app\.light,\s*\.app\.light \.mods-trusted,\s*\.app\.light\.mods-trusted \{/)
    expect(globalCss).toMatch(/\.app\.dark,\s*\.app\.dark \.mods-trusted,\s*\.app\.dark\.mods-trusted \{/)
  })

  it('mod var rules never select a trusted root', () => {
    const css = buildModThemeCss(
      [
        { plugin: 'p', id: 'a', kind: 'vars', mode: 'all', vars: { '--accent': 'red' } },
        { plugin: 'p', id: 'd', kind: 'vars', mode: 'dark', vars: { '--accent': 'red' } }
      ],
      []
    )
    const selectors = css.split('\n').filter((l) => l.endsWith(' {') && !l.startsWith('@'))
    expect(selectors.length).toBe(2)
    for (const sel of selectors) expect(sel).toContain(':not(.mods-trusted)')
  })

  it('consent dialog and mods settings panel render as trusted roots', async () => {
    const { default: ModsConsentDialog } = await import('../ModsConsentDialog')
    render(
      <ModsConsentDialog
        preview={{ name: 'm', version: '1', ok: true, hooks: [], calls: ['$.theme.vars'], findings: [] }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )
    const root = document.querySelector('[data-mods-trusted="consent"]')
    expect(root?.classList.contains('mods-trusted')).toBe(true)
    expect(root?.classList.contains('app')).toBe(true)
    expect(root?.querySelector('.mods-risk')).toHaveTextContent(EN['settings.modsSection.risk.medium'])
    const src = readFileSync(resolve(__dirname, '../ModsSettingsPanel.tsx'), 'utf8')
    expect(src).toContain('mods-settings mods-trusted')
    const chrome = readFileSync(resolve(__dirname, '../ModsChrome.tsx'), 'utf8')
    expect(chrome).toContain('mods-chrome-menu mods-trusted')
  })
})
