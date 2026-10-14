/** Map static hooks/calls analysis into capability rows for the consent dialog. */

/**
 * Claude Code hook names (as `classic.<Name>` or bare `<Name>`) → the Pawn event
 * they run on. Used by `on()` and by the consent capability rows.
 */
export const CLASSIC_EVENT_ALIASES: Record<string, string> = {
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  UserPromptSubmit: 'prompt.submit',
  PreToolUse: 'tool.call',
  PermissionRequest: 'tool.check',
  Stop: 'turn.complete',
  PreCompact: 'session.compact',
  Notification: 'notification'
}

/** `classic.PreToolUse` / `PreToolUse` → `tool.call`; anything else unchanged. Keeps a `{matcher}` suffix. */
export function normalizeModEvent(event: string): string {
  const m = /^(?:classic\.)?([A-Za-z]+)(.*)$/.exec(event)
  if (m && Object.prototype.hasOwnProperty.call(CLASSIC_EVENT_ALIASES, m[1])) return CLASSIC_EVENT_ALIASES[m[1]] + m[2]
  return event
}

export type ModCapabilityId =
  | 'tools'
  | 'files'
  | 'commands'
  | 'network'
  | 'process'
  | 'ui'
  | 'sidebar'
  | 'toolbar'
  | 'settingsPage'
  | 'statusbar'
  | 'palette'
  | 'shortcuts'
  | 'messages'
  | 'theme'
  | 'modelRequests'
  | 'modelResponses'
  | 'notifications'
  | 'subagents'
  | 'providers'
  | 'prompt'
  | 'store'

export interface ModCapability {
  id: ModCapabilityId
  /** i18n key under settings.modsSection.cap.* */
  labelKey: string
  /** i18n key under settings.modsSection.capDesc.* */
  descKey: string
}

const CALL_RULES: Array<{ re: RegExp; id: ModCapabilityId }> = [
  { re: /^\$\.fs\./, id: 'files' },
  { re: /^\$\.process\./, id: 'process' },
  { re: /^\$\.http\./, id: 'network' },
  { re: /^\$\.command\./, id: 'commands' },
  { re: /^\$\.tool\./, id: 'tools' },
  { re: /^\$\.ui\./, id: 'ui' },
  { re: /^\$\.slot\.(sidebar|panel)$/, id: 'sidebar' },
  { re: /^\$\.slot\.(header|toolbar)$/, id: 'toolbar' },
  { re: /^\$\.slot\.settings$/, id: 'settingsPage' },
  { re: /^\$\.slot\.statusbar$/, id: 'statusbar' },
  { re: /^\$\.slot\.palette$/, id: 'palette' },
  { re: /^\$\.slot\.shortcut$/, id: 'shortcuts' },
  { re: /^\$\.theme\.(vars|css)$/, id: 'theme' },
  { re: /^\$\.agent\.register$/, id: 'subagents' },
  { re: /^\$\.provider\.register$/, id: 'providers' },
  { re: /^\$\.prompt\./, id: 'prompt' },
  { re: /^\$\.store\./, id: 'store' }
]

const HOOK_RULES: Array<{ re: RegExp; id: ModCapabilityId }> = [
  { re: /^tool\./, id: 'tools' },
  { re: /^command\./, id: 'commands' },
  { re: /^ui\./, id: 'ui' },
  { re: /^message\./, id: 'messages' },
  { re: /^model\.request/, id: 'modelRequests' },
  { re: /^model\.response/, id: 'modelResponses' },
  { re: /^notification/, id: 'notifications' },
  { re: /^prompt\./, id: 'prompt' },
  { re: /^fs\./, id: 'files' },
  { re: /^http\./, id: 'network' },
  { re: /^process\./, id: 'process' }
]

const ORDER: ModCapabilityId[] = [
  'tools',
  'files',
  'process',
  'network',
  'commands',
  'ui',
  'sidebar',
  'toolbar',
  'settingsPage',
  'statusbar',
  'palette',
  'shortcuts',
  'messages',
  'theme',
  'modelRequests',
  'modelResponses',
  'notifications',
  'subagents',
  'providers',
  'prompt',
  'store'
]

export function deriveModCapabilities(hooks: string[], calls: string[]): ModCapability[] {
  const ids = new Set<ModCapabilityId>()
  for (const raw of hooks) {
    const h = normalizeModEvent(raw)
    for (const rule of HOOK_RULES) {
      if (rule.re.test(h)) ids.add(rule.id)
    }
  }
  for (const c of calls) {
    for (const rule of CALL_RULES) {
      if (rule.re.test(c)) ids.add(rule.id)
    }
  }
  return ORDER.filter((id) => ids.has(id)).map((id) => ({
    id,
    labelKey: `settings.modsSection.cap.${id}`,
    descKey: `settings.modsSection.capDesc.${id}`
  }))
}

export type ModRiskLevel = 'low' | 'medium' | 'high'

/** Coarse risk from capabilities — process/network = high, files/tools = medium. */
export function deriveModRisk(hooks: string[], calls: string[]): ModRiskLevel {
  const caps = new Set(deriveModCapabilities(hooks, calls).map((c) => c.id))
  if (caps.has('process') || caps.has('network') || caps.has('modelRequests') || caps.has('providers')) return 'high'
  if (
    caps.has('files') ||
    caps.has('tools') ||
    caps.has('messages') ||
    caps.has('theme') ||
    caps.has('modelResponses') ||
    caps.has('subagents')
  )
    return 'medium'
  return 'low'
}
