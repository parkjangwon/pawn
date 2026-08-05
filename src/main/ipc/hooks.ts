import { ipcMain } from 'electron'
import {
  getHooksSettings,
  setHooksSettings,
  listHooksSummary,
  runHooks,
  type HookEventName,
  type HooksSettings
} from '../hooks'

export function registerHooksIpc(): void {
  ipcMain.handle('hooks:settings', () => getHooksSettings())

  ipcMain.handle('hooks:setSettings', (_e, partial: Partial<HooksSettings>) => {
    return setHooksSettings(partial || {})
  })

  ipcMain.handle('hooks:list', (_e, projectPath?: string | null) => {
    return listHooksSummary(projectPath || null)
  })

  ipcMain.handle(
    'hooks:run',
    (
      _e,
      input: {
        event: HookEventName
        sessionId?: string
        projectPath?: string | null
        cwd?: string
        payload?: Record<string, unknown>
      }
    ) => {
      if (!input?.event) {
        return {
          ok: false,
          decision: 'none',
          additionalContext: [],
          ran: 0,
          errors: ['event is required']
        }
      }
      return runHooks({
        event: input.event,
        sessionId: input.sessionId,
        projectPath: input.projectPath ?? null,
        cwd: input.cwd,
        payload: input.payload || {}
      })
    }
  )
}
