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

export interface RecordLabels {
  record: string
  stop: string
  /** On-screen pill while a recording runs (native overlay). */
  pill: string
}

/** Record & Replay tray items + the on-screen recording pill. */
export function recordLabels(lang: string): RecordLabels {
  const t: Record<string, RecordLabels> = {
    ko: { record: '워크플로 녹화…', stop: '녹화 중지', pill: 'Pawn이 녹화 중이에요 — Esc를 두 번 누르면 멈춰요' },
    en: { record: 'Record a workflow…', stop: 'Stop recording', pill: 'Pawn is recording — press Esc twice to stop' },
    ja: { record: 'ワークフローを録画…', stop: '録画を停止', pill: 'Pawn が録画中 — Esc を2回押すと停止' },
    zh: { record: '录制工作流…', stop: '停止录制', pill: 'Pawn 正在录制 — 按两次 Esc 停止' }
  }
  return t[lang] || t.en
}
