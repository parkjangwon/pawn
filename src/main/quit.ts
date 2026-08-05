/**
 * Quit confirmation (Cmd+Q / tray Quit) — Chrome-style prompt with optional
 * "don't ask again". Preference lives in ~/.pawn/config.toml settings.confirmQuit
 * (default true = ask).
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { loadConfig, saveConfig } from './config'
import { getMainWindow } from './window'

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
  try {
    const cfg = loadConfig() as { settings?: { language?: string } }
    return cfg.settings?.language || app.getLocale().slice(0, 2) || 'en'
  } catch {
    return 'en'
  }
}

interface QuitDialogCopy {
  message: string
  detail: string
  quit: string
  cancel: string
  dontAsk: string
}

function quitDialogCopy(lang: string): QuitDialogCopy {
  const table: Record<string, QuitDialogCopy> = {
    en: {
      message: 'Quit Pawn?',
      detail: 'Any running agent turn will be cancelled. You can turn off this prompt in Settings → System.',
      quit: 'Quit',
      cancel: 'Cancel',
      dontAsk: "Don't ask again"
    },
    ko: {
      message: 'Pawn을 종료할까요?',
      detail: '실행 중인 에이전트 작업이 있으면 취소됩니다. 설정 → 시스템에서 이 확인을 끌 수 있습니다.',
      quit: '종료',
      cancel: '취소',
      dontAsk: '다시 묻지 않기'
    },
    ja: {
      message: 'Pawn を終了しますか？',
      detail: '実行中のエージェント作業がある場合はキャンセルされます。設定 → システム でこの確認をオフにできます。',
      quit: '終了',
      cancel: 'キャンセル',
      dontAsk: '今後表示しない'
    },
    zh: {
      message: '要退出 Pawn 吗？',
      detail: '若有正在运行的代理任务将被取消。可在 设置 → 系统 中关闭此确认。',
      quit: '退出',
      cancel: '取消',
      dontAsk: '不再询问'
    }
  }
  return table[lang] || table.en
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

    event.preventDefault()

    const copy = quitDialogCopy(dialogLanguage())
    const win = getMainWindow()
    const parent: BrowserWindow | undefined =
      win && !win.isDestroyed() ? win : undefined

    const boxOpts = {
      type: 'question' as const,
      buttons: [copy.cancel, copy.quit],
      defaultId: 1,
      cancelId: 0,
      message: copy.message,
      detail: copy.detail,
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
