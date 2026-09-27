/**
 * Quit confirmation (Cmd+Q / tray Quit) — Chrome-style prompt with optional
 * "don't ask again". Preference lives in ~/.pawn/config.toml settings.confirmQuit
 * (default true = ask).
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { loadConfig, saveConfig } from './config'
import { getMainWindow } from './window'
import { appLanguage } from './appLanguage'
import { streamingSessionCount } from './streamingState'
import { getAllRoutines } from './db'

let allowQuit = false

export function forceAllowQuit(): void {
  allowQuit = true
}

export function isConfirmQuitEnabled(): boolean {
  try {
    const cfg = loadConfig() as { settings?: { confirmQuit?: boolean } }
    // Default: ask before quit. Explicit false disables the prompt.
    return cfg.settings?.confirmQuit !== false
  } catch {
    return true
  }
}

export function setConfirmQuitEnabled(enabled: boolean): void {
  saveConfig({ settings: { confirmQuit: enabled } })
}

function dialogLanguage(): string {
  return appLanguage()
}

interface QuitDialogCopy {
  message: string
  detail: string
  /** Why asking now: agent work running / scheduled automations pause. */
  running: (count: number) => string
  automations: (count: number) => string
  quit: string
  cancel: string
  dontAsk: string
}

function quitDialogCopy(lang: string): QuitDialogCopy {
  const table: Record<string, QuitDialogCopy> = {
    en: {
      message: 'Quit Pawn?',
      detail: 'You can turn off this prompt in Settings → System.',
      running: (n) => (n === 1 ? 'An agent task is still running and will be cancelled.' : `${n} agent tasks are still running and will be cancelled.`),
      automations: (n) => (n === 1 ? '1 scheduled automation won’t run while Pawn is closed.' : `${n} scheduled automations won’t run while Pawn is closed.`),
      quit: 'Quit',
      cancel: 'Cancel',
      dontAsk: "Don't ask again"
    },
    ko: {
      message: 'Pawn을 종료할까요?',
      detail: '설정 → 시스템에서 이 확인을 끌 수 있어요.',
      running: (n) => `실행 중인 에이전트 작업 ${n}개가 취소돼요.`,
      automations: (n) => `예약된 자동화 ${n}개는 Pawn이 꺼져 있는 동안 실행되지 않아요.`,
      quit: '종료',
      cancel: '취소',
      dontAsk: '다시 묻지 않기'
    },
    ja: {
      message: 'Pawn を終了しますか？',
      detail: '設定 → システム でこの確認をオフにできます。',
      running: (n) => `実行中のエージェント作業 ${n} 件がキャンセルされます。`,
      automations: (n) => `予約済みの自動化 ${n} 件は Pawn の終了中は実行されません。`,
      quit: '終了',
      cancel: 'キャンセル',
      dontAsk: '今後表示しない'
    },
    zh: {
      message: '要退出 Pawn 吗？',
      detail: '可在 设置 → 系统 中关闭此确认。',
      running: (n) => `${n} 个正在运行的代理任务将被取消。`,
      automations: (n) => `Pawn 关闭期间，${n} 个已计划的自动化不会运行。`,
      quit: '退出',
      cancel: '取消',
      dontAsk: '不再询问'
    }
  }
  return table[lang] || table.en
}

/** Scheduled (not manual) automations that are switched on. */
function scheduledAutomationCount(): number {
  try {
    return getAllRoutines().filter((r) => {
      if (!r.enabled) return false
      try {
        return (JSON.parse(r.schedule) as { type?: string }).type !== 'manual'
      } catch {
        return true
      }
    }).length
  } catch {
    return 0
  }
}

/**
 * What quitting right now would cost the user. Nothing → quit without asking
 * (asking every time trains people to click through the one prompt that matters).
 */
export function quitStakes(): { running: number; automations: number } {
  return { running: streamingSessionCount(), automations: scheduledAutomationCount() }
}

/**
 * Register before-quit guard. Call once after app is ready enough to show dialogs.
 * Safe to call before windows exist (dialog falls back to app-modal).
 */
export function registerQuitConfirm(): void {
  app.on('before-quit', (event) => {
    if (allowQuit) return
    if (!isConfirmQuitEnabled()) {
      allowQuit = true
      return
    }

    const stakes = quitStakes()
    if (stakes.running === 0 && stakes.automations === 0) {
      allowQuit = true
      return
    }

    event.preventDefault()

    const copy = quitDialogCopy(dialogLanguage())
    const reasons = [
      stakes.running > 0 ? copy.running(stakes.running) : '',
      stakes.automations > 0 ? copy.automations(stakes.automations) : ''
    ].filter(Boolean)
    const win = getMainWindow()
    const parent: BrowserWindow | undefined =
      win && !win.isDestroyed() ? win : undefined

    const boxOpts = {
      type: 'question' as const,
      buttons: [copy.cancel, copy.quit],
      defaultId: 1,
      cancelId: 0,
      message: copy.message,
      detail: [...reasons, '', copy.detail].join('\n'),
      checkboxLabel: copy.dontAsk,
      checkboxChecked: false,
      noLink: true
    }
    const dialogPromise = parent
      ? dialog.showMessageBox(parent, boxOpts)
      : dialog.showMessageBox(boxOpts)
    void dialogPromise
      .then((result) => {
        if (result.response !== 1) return
        if (result.checkboxChecked) {
          try {
            setConfirmQuitEnabled(false)
          } catch {
            /* ignore */
          }
        }
        allowQuit = true
        app.quit()
      })
      .catch(() => {
        // Dialog failed — allow quit so the user is not stuck.
        allowQuit = true
        app.quit()
      })
  })
}
