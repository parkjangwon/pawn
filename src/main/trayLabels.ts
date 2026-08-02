/** Pure tray menu labels — kept free of Electron imports so it is unit-testable. */

export interface TrayLabels {
  show: string
  open: string
  quit: string
}

export function menuLabels(lang: string, isWin: boolean): TrayLabels {
  const show: Record<string, { mac: string; win: string }> = {
    ko: { mac: '메뉴바에 표시', win: '트레이에 표시' },
    en: { mac: 'Show in menu bar', win: 'Show in system tray' },
    ja: { mac: 'メニューバーに表示', win: 'トレイに表示' },
    zh: { mac: '在菜单栏中显示', win: '在托盘中显示' }
  }
  const open: Record<string, string> = {
    ko: 'Pawn 열기', en: 'Open Pawn', ja: 'Pawn を開く', zh: '打开 Pawn'
  }
  const quit: Record<string, string> = {
    ko: 'Pawn 종료', en: 'Quit Pawn', ja: 'Pawn を終了', zh: '退出 Pawn'
  }
  return {
    show: (show[lang] || show.en)[isWin ? 'win' : 'mac'],
    open: open[lang] || open.en,
    quit: quit[lang] || quit.en
  }
}
