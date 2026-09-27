import { describe, it, expect } from 'vitest'
import { applyDecisionEnvKeys } from '../config'
import { createNodeApi } from '../nodeApi'

describe('headless decision models', () => {
  it('takes keys from the environment and disables hosted providers without one', () => {
    const cfg = {
      providers: [
        { id: 'a', kind: 'typesafe', baseUrl: 'https://api.typesafe.ai', apiKey: 'enc:v1:zzz', enabled: true },
        { id: 'b', kind: 'ollaya', baseUrl: 'http://localhost:11435', enabled: false }
      ]
    }
    const none = applyDecisionEnvKeys(cfg, {}) as { providers: Array<Record<string, unknown>> }
    expect(none.providers[0]).toMatchObject({ enabled: false })
    expect(none.providers[0].apiKey).toBeUndefined()
    const withKey = applyDecisionEnvKeys(cfg, { TYPESAFE_API_KEY: 'ts-env' }) as { providers: Array<Record<string, unknown>> }
    expect(withKey.providers[0]).toMatchObject({ enabled: true, apiKey: 'ts-env' })
  })

  it('exposes the same decision API as the desktop app, in memory', async () => {
    const { api, dispose } = createNodeApi({
      config: {
        decision: {
          version: 1,
          providers: [{ id: 'dp-1', kind: 'ollaya', name: 'Ollaya', baseUrl: 'http://localhost:11435', model: 'laya', enabled: true }],
          features: { agentTool: true, shellRiskGuard: false, routerAssist: false }
        }
      },
      lsp: false
    })
    try {
      const st = await api.decision.status()
      expect(st.active).toMatchObject({ id: 'dp-1', local: true })
      expect(st.features.shellRiskGuard).toBe(false)
      const r = await api.decision.decide({ state: 'x', questions: { q: { type: 'noul' } } }, { purpose: 'shell_risk' })
      expect(r).toMatchObject({ ok: false, code: 'disabled' })
      await api.decision.setEnabled('dp-1', false)
      expect((await api.decision.status()).active).toBeNull()
    } finally {
      dispose()
    }
  })
})
