import { handleTrusted } from './trust'
import {
  getHooksSettings,
  setHooksSettings,
  listHooksSummary,
  runHooks,
  type HookEventName,
  type HooksSettings
} from '../hooks'

export function registerHooksIpc(): void {
  handleTrusted('hooks:settings', async () => getHooksSettings())

  handleTrusted('hooks:setSettings', async (_e, partial: Partial<HooksSettings>) => {
    return setHooksSettings(partial || {})
  })

  handleTrusted('hooks:list', async (_e, projectPath?: string | null) => {
    return listHooksSummary(projectPath || null)
  })

  handleTrusted(
    'hooks:run',
    async (
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
      try {
        return await runHooks({
          event: input.event,
          sessionId: input.sessionId,
          projectPath: input.projectPath ?? null,
          cwd: input.cwd,
          payload: input.payload || {}
        })
      } catch (err) {
        return {
          ok: false,
          decision: 'none',
          additionalContext: [],
          ran: 0,
          errors: [err instanceof Error ? err.message : String(err)]
        }
      }
    }
  )
}
