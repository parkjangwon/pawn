/** Map static hooks/calls analysis into human-readable capability chips. */

export type ModCapabilityId =
  | 'tools'
  | 'files'
  | 'commands'
  | 'network'
  | 'process'
  | 'ui'
  | 'prompt'
  | 'store'

export interface ModCapability {
  id: ModCapabilityId
  /** i18n key under settings.modsSection.cap.* */
  labelKey: string
}

const CALL_RULES: Array<{ re: RegExp; id: ModCapabilityId }> = [
  { re: /^\$\.fs\./, id: 'files' },
  { re: /^\$\.process\./, id: 'process' },
  { re: /^\$\.http\./, id: 'network' },
  { re: /^\$\.command\./, id: 'commands' },
  { re: /^\$\.tool\./, id: 'tools' },
  { re: /^\$\.ui\./, id: 'ui' },
  { re: /^\$\.prompt\./, id: 'prompt' },
  { re: /^\$\.store\./, id: 'store' }
]

const HOOK_RULES: Array<{ re: RegExp; id: ModCapabilityId }> = [
  { re: /^tool\./, id: 'tools' },
  { re: /^command\./, id: 'commands' },
  { re: /^ui\./, id: 'ui' },
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
  'prompt',
  'store'
]

export function deriveModCapabilities(hooks: string[], calls: string[]): ModCapability[] {
  const ids = new Set<ModCapabilityId>()
  for (const h of hooks) {
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
    labelKey: `settings.modsSection.cap.${id}`
  }))
}

export type ModRiskLevel = 'low' | 'medium' | 'high'

/** Coarse risk from capabilities — process/network = high, files/tools = medium. */
export function deriveModRisk(hooks: string[], calls: string[]): ModRiskLevel {
  const caps = new Set(deriveModCapabilities(hooks, calls).map((c) => c.id))
  if (caps.has('process') || caps.has('network')) return 'high'
  if (caps.has('files') || caps.has('tools')) return 'medium'
  return 'low'
}
