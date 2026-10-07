import { tx } from '../../i18n'

const EVENT_KEYS: Record<string, string> = {
  'session.start': 'chat.mods.events.sessionStart',
  'session.end': 'chat.mods.events.sessionEnd',
  'session.compact': 'chat.mods.events.sessionCompact',
  'turn.complete': 'chat.mods.events.turnComplete',
  'tool.call': 'chat.mods.events.toolCall',
  'prompt.submit': 'chat.mods.events.promptSubmit',
  'command.run': 'chat.mods.events.commandRun',
  'ui.render': 'chat.mods.events.uiRender',
  'ui.press': 'chat.mods.events.uiPress',
  'ui.input': 'chat.mods.events.uiInput',
  'ui.select': 'chat.mods.events.uiSelect'
}

/** Human label for a mod hook name. Unknown events stay as written. */
export function modEventLabel(event: string): string {
  const key = EVENT_KEYS[event]
  if (!key) return event
  const label = tx(key)
  return label === key ? event : label
}

export function modConflictLine(event: string, plugins: string[]): string {
  return `${plugins.join(', ')} share the same ${modEventLabel(event)}.`
}
