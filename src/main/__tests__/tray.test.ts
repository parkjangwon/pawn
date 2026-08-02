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
