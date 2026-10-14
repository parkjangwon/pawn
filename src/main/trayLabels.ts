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

/**
 * The tray / menu bar context menu is always English, regardless of the app
 * language or OS locale. Labels are explicit (no Electron roles), so nothing
 * picks up the system locale either.
 */
export function trayMenuLabels(isWin: boolean): TrayLabels {
  return menuLabels('en', isWin)
}

/** Record & Replay tray items, always English (see trayMenuLabels). */
export function trayRecordLabels(): { record: string; stop: string } {
  const { record, stop } = recordLabels('en')
  return { record, stop }
}

export interface TrayMenuItemSpec {
  id: 'show' | 'separator' | 'open' | 'record' | 'stop' | 'quit'
  label?: string
}

/** Pure description of the tray menu items, in order (unit-testable). */
export function trayMenuSpec(opts: { isWin: boolean; canRecord: boolean; recording: boolean }): TrayMenuItemSpec[] {
  const l = trayMenuLabels(opts.isWin)
  const r = trayRecordLabels()
  const items: TrayMenuItemSpec[] = [
    { id: 'show', label: l.show },
    { id: 'separator' },
    { id: 'open', label: l.open }
  ]
  if (opts.canRecord) items.push(opts.recording ? { id: 'stop', label: `● ${r.stop}` } : { id: 'record', label: r.record })
  items.push({ id: 'quit', label: l.quit })
  return items
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
