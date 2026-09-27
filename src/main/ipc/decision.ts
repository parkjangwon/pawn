import { handleTrusted } from './trust'
import { createDecisionService, type DecisionService } from '../decision/service'
import { createFileDecisionStore } from '../decision/store'
import type { DecisionPurpose } from '../decision/types'

let service: DecisionService | null = null

export function getDecisionService(): DecisionService {
  if (!service) service = createDecisionService({ store: createFileDecisionStore() })
  return service
}

const PURPOSES: DecisionPurpose[] = ['tool', 'shell_risk', 'routing']

/** Decision models (Settings → Decision models): registry + calls via the TypeSafe SDK. */
export function registerDecisionIpc(): void {
  const svc = getDecisionService()
  handleTrusted('decision:status', () => svc.status())
  handleTrusted('decision:saveProvider', (_e, input: unknown) => svc.saveProvider(input))
  handleTrusted('decision:removeProvider', (_e, id: unknown) => svc.removeProvider(id))
  handleTrusted('decision:setEnabled', (_e, id: unknown, enabled: unknown) => svc.setEnabled(id, enabled))
  handleTrusted('decision:setFeatures', (_e, partial: unknown) => svc.setFeatures(partial))
  handleTrusted('decision:models', (_e, id: unknown) => svc.listModels(id))
  handleTrusted('decision:test', (_e, id: unknown) => svc.test(id))
  handleTrusted('decision:decide', (_e, input: unknown, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const purpose = PURPOSES.includes(o.purpose as DecisionPurpose) ? (o.purpose as DecisionPurpose) : 'tool'
    const timeoutMs = typeof o.timeoutMs === 'number' ? o.timeoutMs : undefined
    const maxRetries = typeof o.maxRetries === 'number' ? o.maxRetries : undefined
    return svc.decide(input, { purpose, timeoutMs, maxRetries })
  })
}
