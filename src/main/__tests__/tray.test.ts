import { describe, it, expect } from 'vitest'
import { menuLabels } from '../trayLabels'

describe('tray menu labels', () => {
  it('localizes the show/open/quit labels', () => {
    expect(menuLabels('ko', false)).toEqual({ show: '메뉴바에 표시', open: 'Pawn 열기', quit: 'Pawn 종료' })
    expect(menuLabels('en', false)).toEqual({ show: 'Show in menu bar', open: 'Open Pawn', quit: 'Quit Pawn' })
    expect(menuLabels('ja', false)).toEqual({ show: 'メニューバーに表示', open: 'Pawn を開く', quit: 'Pawn を終了' })
    expect(menuLabels('zh', false)).toEqual({ show: '在菜单栏中显示', open: '打开 Pawn', quit: '退出 Pawn' })
  })

  it('uses tray wording on Windows', () => {
    expect(menuLabels('ko', true).show).toBe('트레이에 표시')
    expect(menuLabels('en', true).show).toBe('Show in system tray')
    expect(menuLabels('zh', true).show).toBe('在托盘中显示')
  })

  it('falls back to English for unknown languages', () => {
    expect(menuLabels('xx', false)).toEqual(menuLabels('en', false))
  })
})

import { trayMenuSpec, trayMenuLabels } from '../trayLabels'

const HANGUL = /[\uac00-\ud7a3]/

describe('tray context menu is English', () => {
  const combos = [false, true].flatMap((isWin) =>
    [false, true].flatMap((canRecord) => [false, true].map((recording) => ({ isWin, canRecord, recording })))
  )

  it.each(combos)('has English labels with no Hangul (%o)', (opts) => {
    const spec = trayMenuSpec(opts)
    for (const item of spec) {
      if (item.id === 'separator') continue
      expect(item.label).toBeTruthy()
      expect(item.label).not.toMatch(HANGUL)
      expect(item.label).toMatch(/^[\x20-\x7e●…]+$/)
    }
    expect(spec.map((i) => i.id)[0]).toBe('show')
    expect(spec.at(-1)).toEqual({ id: 'quit', label: 'Quit Pawn' })
  })

  it('uses the exact English labels on macOS', () => {
    expect(trayMenuSpec({ isWin: false, canRecord: true, recording: false })).toEqual([
      { id: 'show', label: 'Show in menu bar' },
      { id: 'separator' },
      { id: 'open', label: 'Open Pawn' },
      { id: 'record', label: 'Record a workflow…' },
      { id: 'quit', label: 'Quit Pawn' }
    ])
    expect(trayMenuSpec({ isWin: false, canRecord: true, recording: true })[3]).toEqual({ id: 'stop', label: '● Stop recording' })
    expect(trayMenuLabels(true).show).toBe('Show in system tray')
  })

  it('tray.ts builds from the English spec and uses no Electron roles', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(join(__dirname, '..', 'tray.ts'), 'utf8')
    expect(src).toContain('trayMenuSpec(')
    expect(src).not.toMatch(/role\s*:/)
    expect(src).not.toMatch(HANGUL)
    expect(src).not.toMatch(/appLanguage\(\)/)
  })
})
