import { uid } from '../../utils/uid'
import { useProviderStore } from '../../stores/provider'
import { useThemeStore } from '../../stores/theme'
import { useRoutineStore } from '../../stores/routine'
import type { ToolHandler } from './types'


const app_open_tab: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const tab = String(call.arguments.tab || '')
        const valid = ['terminal', 'files', 'git', 'browser', 'diff', 'artifacts']
        if (!valid.includes(tab)) {
          return { toolCallId: call.id, content: `Unknown tab "${tab}". Valid tabs: ${valid.join(', ')}`, isError: true }
        }
        try { (window as any).__openRightPanelTab?.(tab) } catch {}
        return { toolCallId: call.id, content: `Opened right panel on tab: ${tab}` }
      }


const app_close_tab: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const tab = String(call.arguments.tab || '')
        const valid = ['terminal', 'files', 'git', 'browser', 'diff', 'artifacts']
        if (!valid.includes(tab)) {
          return { toolCallId: call.id, content: `Unknown tab "${tab}". Valid tabs: ${valid.join(', ')}`, isError: true }
        }
        try { (window as any).__closeRightPanelTab?.(tab) } catch {}
        return { toolCallId: call.id, content: `Closed tab: ${tab}` }
      }


const app_list_automations: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.routine) {
          return { toolCallId: call.id, content: 'Automations are unavailable in this environment.', isError: true }
        }
        const rows = await api.routine.list()
        if (!Array.isArray(rows) || rows.length === 0) {
          return { toolCallId: call.id, content: 'No automations configured.' }
        }
        const lines = rows.map((r) => {
          const scheduleLabel = (() => {
            try {
              const parsed = JSON.parse(r.schedule) as { type?: string; minutes?: number; hour?: number; minute?: number; weekday?: number }
              if (parsed.type === 'interval') return `interval/${Math.max(1, Number(parsed.minutes) || 1)}m`
              if (parsed.type === 'weekly') return `weekly/${parsed.weekday ?? 0} ${String(parsed.hour ?? 0).padStart(2, '0')}:${String(parsed.minute ?? 0).padStart(2, '0')}`
              return `daily/${String(parsed.hour ?? 0).padStart(2, '0')}:${String(parsed.minute ?? 0).padStart(2, '0')}`
            } catch {
              return 'unknown'
            }
          })()
          return `- ${r.name} [${r.id}] enabled=${r.enabled ? 'yes' : 'no'} schedule=${scheduleLabel}`
        })
        return { toolCallId: call.id, content: `Automations (${rows.length}):\n${lines.join('\n')}` }
      }


const app_create_automation: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.routine) {
          return { toolCallId: call.id, content: 'Automations are unavailable in this environment.', isError: true }
        }

        const name = String(call.arguments.name ?? '').trim()
        const prompt = String(call.arguments.prompt ?? '').trim()
        const scheduleType = String(call.arguments.scheduleType ?? '').trim()
        if (!name || !prompt) {
          return { toolCallId: call.id, content: 'name and prompt are required.', isError: true }
        }
        if (!['manual', 'interval', 'daily', 'weekly'].includes(scheduleType)) {
          return { toolCallId: call.id, content: 'scheduleType must be one of: manual, interval, daily, weekly.', isError: true }
        }

        const toInt = (v: unknown, fallback: number): number => {
          const n = Number(v)
          return Number.isFinite(n) ? Math.trunc(n) : fallback
        }
        const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

        const schedule: RoutineSchedule = (() => {
          if (scheduleType === 'interval') {
            const minutes = Math.max(1, toInt(call.arguments.intervalMinutes, 30))
            return { type: 'interval', minutes }
          }
          if (scheduleType === 'weekly') {
            const weekday = clamp(toInt(call.arguments.weekday, 1), 0, 6)
            const hour = clamp(toInt(call.arguments.hour, 9), 0, 23)
            const minute = clamp(toInt(call.arguments.minute, 0), 0, 59)
            return { type: 'weekly', weekday, hour, minute }
          }
          const hour = clamp(toInt(call.arguments.hour, 9), 0, 23)
          const minute = clamp(toInt(call.arguments.minute, 0), 0, 59)
          return { type: 'daily', hour, minute }
        })()

        const id = uid('routine-')
        const create = await api.routine.add({
          id,
          name,
          prompt,
          schedule: JSON.stringify(schedule),
          projectId: String(call.arguments.projectId ?? '').trim() || undefined,
          sessionId: String(call.arguments.sessionId ?? '').trim() || undefined
        })
        if (create?.error) {
          return { toolCallId: call.id, content: create.error, isError: true }
        }

        const requestedEnabled = call.arguments.enabled
        const shouldEnable = scheduleType === 'manual'
          ? false
          : requestedEnabled === undefined
            ? true
            : Boolean(requestedEnabled)

        if (!shouldEnable) {
          await api.routine.setEnabled(id, false)
        }

        await useRoutineStore.getState().refresh()

        const scheduleText = scheduleType === 'interval'
          ? `interval/${(schedule as { type: 'interval'; minutes: number }).minutes}m`
          : scheduleType === 'weekly'
            ? `weekly/${(schedule as { type: 'weekly'; weekday: number; hour: number; minute: number }).weekday} ${String((schedule as { type: 'weekly'; weekday: number; hour: number; minute: number }).hour).padStart(2, '0')}:${String((schedule as { type: 'weekly'; weekday: number; hour: number; minute: number }).minute).padStart(2, '0')}`
            : `daily/${String((schedule as { type: 'daily'; hour: number; minute: number }).hour).padStart(2, '0')}:${String((schedule as { type: 'daily'; hour: number; minute: number }).minute).padStart(2, '0')}`

        return {
          toolCallId: call.id,
          content: `Automation created: ${name} [${id}]\nEnabled: ${shouldEnable ? 'yes' : 'no'}\nSchedule: ${scheduleText}`
        }
      }


const app_set_model: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const requested = String(call.arguments.model ?? '').trim()
        const { models, setActiveModel, setRoutingMode } = useProviderStore.getState()
        if (!requested || requested === 'auto') {
          setActiveModel(null)
          setRoutingMode('auto')
          return { toolCallId: call.id, content: 'Model set to auto (router picks per task)' }
        }
        const target = models.find((m) =>
          m.id === requested || m.modelId === requested || m.label === requested
        )
        if (!target) {
          const available = models.filter((m) => m.enabled).map((m) => m.label || m.modelId).join(', ')
          return {
            toolCallId: call.id,
            content: `Unknown model "${requested}". Configured models: ${available || '(none)'}`,
            isError: true
          }
        }
        setActiveModel(target.id)
        return { toolCallId: call.id, content: `Model set to ${target.label || target.modelId}` }
      }


const app_set_permission_mode: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const mode = call.arguments.mode as 'ask' | 'auto' | 'yolo'
        if (!['ask', 'auto', 'yolo'].includes(mode)) {
          return { toolCallId: call.id, content: `Unknown permission mode "${mode}". Valid: ask, auto, yolo`, isError: true }
        }
        useProviderStore.getState().setPermissionMode(mode)
        return { toolCallId: call.id, content: `Permission mode set to ${mode}` }
      }

const app_set_agent_mode: ToolHandler = async (call, _projectPath, _signal, _ctx, _api) => {
  const mode = String(call.arguments.mode || '').toLowerCase()
  if (mode !== 'plan' && mode !== 'build') {
    return {
      toolCallId: call.id,
      content: `Unknown agent mode "${mode}". Valid: plan, build`,
      isError: true
    }
  }
  useProviderStore.getState().setAgentMode(mode)
  return {
    toolCallId: call.id,
    content:
      mode === 'plan'
        ? 'Agent mode: Plan (read-only explore; mutations blocked)'
        : 'Agent mode: Build (full tools; permission mode still applies)'
  }
}

const app_set_reasoning: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const effort = call.arguments.effort as 'auto' | 'low' | 'medium' | 'high'
        if (!['auto', 'low', 'medium', 'high'].includes(effort)) {
          return { toolCallId: call.id, content: `Unknown reasoning effort "${effort}". Valid: auto, low, medium, high`, isError: true }
        }
        useProviderStore.getState().setReasoningEffort(effort)
        return { toolCallId: call.id, content: `Reasoning effort set to ${effort}` }
      }


const app_toggle_theme: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        useThemeStore.getState().toggle()
        return { toolCallId: call.id, content: 'Theme toggled' }
      }


export const appHandlers: Record<string, ToolHandler> = {
  'app_open_tab': app_open_tab,
  'app_close_tab': app_close_tab,
  'app_list_automations': app_list_automations,
  'app_create_automation': app_create_automation,
  'app_set_model': app_set_model,
  'app_set_permission_mode': app_set_permission_mode,
  'app_set_agent_mode': app_set_agent_mode,
  'app_set_reasoning': app_set_reasoning,
  'app_toggle_theme': app_toggle_theme,
}
