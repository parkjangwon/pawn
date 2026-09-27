import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { setAboutPanelOptions: vi.fn() }, Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((t) => t) }, shell: { openExternal: vi.fn() } }))
vi.mock('../window', () => ({ getMainWindow: () => null }))

import { appLanguage, normalizeLang, setAppLanguage, stringTables, SUPPORTED_LANGS, ui } from '../appLanguage'
import { appMenuTemplate } from '../appMenu'

describe('main-process app language', () => {
  it('normalizes OS / saved values to a supported language', () => {
    expect(normalizeLang('ko-KR')).toBe('ko')
    expect(normalizeLang('ja')).toBe('ja')
    expect(normalizeLang('zh-Hans-CN')).toBe('zh')
    expect(normalizeLang('de-DE')).toBe('en')
    expect(normalizeLang(undefined)).toBe('en')
    expect(setAppLanguage('ko')).toBe('ko')
    expect(appLanguage()).toBe('ko')
    expect(ui('closeRunning').close).toBe('그래도 닫기')
    setAppLanguage('en')
  })

  it('has the same keys, all non-empty, in every language', () => {
    for (const [group, byLang] of Object.entries(stringTables())) {
      const keys = Object.keys(byLang.en).sort()
      for (const l of SUPPORTED_LANGS) {
        expect(Object.keys(byLang[l]).sort(), `${group}.${l}`).toEqual(keys)
        for (const k of keys) expect(byLang[l][k], `${group}.${l}.${k}`).toBeTruthy()
      }
    }
  })

  it('builds the macOS app menu in the app language with standard roles', () => {
    setAppLanguage('ko')
    const menu = appMenuTemplate(true)
    expect(menu.map((m) => m.label)).toEqual(['Pawn', '편집', '보기', '윈도우', '도움말'])
    const app = menu[0].submenu as { role?: string; label?: string }[]
    expect(app.find((i) => i.role === 'quit')?.label).toBe('Pawn 종료')
    expect(app.find((i) => i.role === 'hide')?.label).toBe('Pawn 가리기')
    const edit = menu[1].submenu as { role?: string }[]
    expect(edit.map((i) => i.role)).toEqual(['undo', 'redo', undefined, 'cut', 'copy', 'paste', 'selectAll'])
    // Windows/Linux: no app menu, quit lives under Help.
    const win = appMenuTemplate(false)
    expect(win[0].label).toBe('편집')
    expect((win.at(-1)!.submenu as { role?: string }[]).some((i) => i.role === 'quit')).toBe(true)
    setAppLanguage('en')
  })
})
