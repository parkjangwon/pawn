import type { ToolDefinition } from '../toolDefinitionsTypes'

export const APP_TOOLS: ToolDefinition[] = [
  {
    name: 'app_open_tab',
    description: 'Open an app tool surface: terminal (bottom panel), or files/git/browser/diff/artifacts (right panel). Use this to show the user what you are doing.',
    parameters: {
      type: 'object',
      properties: { tab: { type: 'string', enum: ['terminal', 'files', 'git', 'browser', 'diff', 'artifacts'], description: 'Which app tool to open (terminal is the bottom panel; others open in the right panel)' } },
      required: ['tab']
    }
  },
  {
    name: 'app_close_tab',
    description: 'Close an app tool surface: terminal (bottom panel), or files/git/browser/diff/artifacts (right panel). Closing the browser also discards its current page.',
    parameters: {
      type: 'object',
      properties: { tab: { type: 'string', enum: ['terminal', 'files', 'git', 'browser', 'diff', 'artifacts'], description: 'Which app tool to close' } },
      required: ['tab']
    }
  },
  {
    name: 'app_list_automations',
    description: 'List configured automations in the app so you can review names, schedules, enabled status, and ids before changing them.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'app_create_automation',
    description: 'Create a new automation in the app without writing SQL. Use this when users ask to set up recurring work.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Automation name shown in the UI' },
        prompt: { type: 'string', description: 'Prompt the agent will run when this automation fires' },
        scheduleType: { type: 'string', enum: ['manual', 'interval', 'daily', 'weekly'], description: 'When the automation should run' },
        intervalMinutes: { type: 'number', description: 'For scheduleType=interval. Minutes between runs (>=1)' },
        hour: { type: 'number', description: 'For daily/weekly schedules. 0-23' },
        minute: { type: 'number', description: 'For daily/weekly schedules. 0-59' },
        weekday: { type: 'number', description: 'For weekly schedule. 0=Sun..6=Sat' },
        projectId: { type: 'string', description: 'Optional target project id. Empty means general/no project.' },
        sessionId: { type: 'string', description: 'Optional existing session id to bind.' },
        enabled: { type: 'boolean', description: 'Optional. Defaults to true unless scheduleType is manual.' }
      },
      required: ['name', 'prompt', 'scheduleType']
    }
  },
  {
    name: 'app_set_model',
    description: 'Change the active model used for replies. Pass "auto" to let the router pick the best model, or a model id/label from the configured models. Takes effect from the next request.',
    parameters: {
      type: 'object',
      properties: { model: { type: 'string', description: '"auto" or a configured model id/label' } },
      required: ['model']
    }
  },
  {
    name: 'app_set_permission_mode',
    description: 'Change how tool permissions are handled: ask (confirm each risky action), auto (auto-approve safe actions), yolo (approve everything without asking).',
    parameters: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['ask', 'auto', 'yolo'], description: 'Permission mode' } },
      required: ['mode']
    }
  },
  {
    name: 'app_set_reasoning',
    description: 'Set the reasoning effort for reasoning-capable models: auto, low, medium or high.',
    parameters: {
      type: 'object',
      properties: { effort: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: 'Reasoning effort' } },
      required: ['effort']
    }
  },
  {
    name: 'app_toggle_theme',
    description: 'Switch the app between light and dark theme.',
    parameters: { type: 'object', properties: {} }
  }
]
