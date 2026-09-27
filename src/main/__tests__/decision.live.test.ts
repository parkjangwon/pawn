/**
 * Live TypeSafe API checks through Pawn's decision service + the official SDK.
 * Skipped unless PAWN_TYPESAFE_E2E=1. The auth probe needs no key; the
 * decision test also needs TYPESAFE_API_KEY (costs a few hundred tokens).
 *
 *   PAWN_TYPESAFE_E2E=1 TYPESAFE_API_KEY=… npx vitest run src/main/__tests__/decision.live.test.ts
 */
import { describe, it, expect } from 'vitest'
import { createDecisionService } from '../decision/service'
import { emptyDecisionConfig, type DecisionConfig } from '../decision/types'

const LIVE = process.env.PAWN_TYPESAFE_E2E === '1'
const KEY = process.env.TYPESAFE_API_KEY?.trim() || ''

function service() {
  let cfg: DecisionConfig = emptyDecisionConfig()
  return createDecisionService({
    store: {
      load: () => JSON.parse(JSON.stringify(cfg)) as DecisionConfig,
      save: (c) => {
        cfg = JSON.parse(JSON.stringify(c)) as DecisionConfig
      }
    }
  })
}

describe.skipIf(!LIVE)('TypeSafe API (live, PAWN_TYPESAFE_E2E=1)', () => {
  it('reaches api.typesafe.ai and maps a rejected key to a clear error', async () => {
    const svc = service()
    const saved = svc.saveProvider({ kind: 'typesafe', apiKey: 'pawn-invalid-probe-key' })
    if (!saved.ok) throw new Error(saved.error)
    const r = await svc.test(saved.id)
    expect(r).toMatchObject({ ok: false, status: 401, code: 'authentication_error' })
    if (!r.ok) expect(r.error).toBe('Invalid or missing API key for TypeSafe')
    const models = await svc.listModels(saved.id)
    expect(models.ok).toBe(false)
  }, 30_000)

  it.skipIf(!KEY)('lists models and answers all three primitives with jev-latest', async () => {
    const svc = service()
    const saved = svc.saveProvider({ kind: 'typesafe', apiKey: KEY })
    if (!saved.ok) throw new Error(saved.error)

    const models = await svc.listModels(saved.id)
    expect(models.ok).toBe(true)
    if (models.ok) expect(models.models.map((m) => m.name)).toContain('jev-latest')

    const r = await svc.decide(
      {
        state: 'I was charged twice for my subscription this month. Please refund the second charge today.',
        questions: {
          team: {
            type: 'choice',
            instructions: 'Which team should handle this ticket?',
            criteria: { billing: 'Payments, invoices, refunds', technical: 'Bugs and outages', account: 'Login and access' }
          },
          urgency: { type: 'score', instructions: 'How urgent is this?', criteria: ['Can wait', 'This week', 'Today'] },
          refund: { type: 'noul', instructions: 'Does the customer ask for money back?' }
        }
      },
      { purpose: 'tool', timeoutMs: 20_000 }
    )
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    expect(r.model).toMatch(/^jev-/)
    expect(r.provider).toMatchObject({ kind: 'typesafe', local: false })
    expect(r.answers.team).toMatchObject({ type: 'choice', choice: 'billing' })
    expect(r.answers.refund.type).toBe('noul')
    if (r.answers.refund.type === 'noul') expect(r.answers.refund.noul).toBeGreaterThan(0.5)
    expect(r.answers.urgency.type).toBe('score')
    console.log(`[typesafe live] ${r.model} in ${r.latencyMs} ms`, JSON.stringify(r.answers))
  }, 60_000)

  it.skipIf(!KEY)('rates a destructive shell command the way the risk check expects', async () => {
    const svc = service()
    const saved = svc.saveProvider({ kind: 'typesafe', apiKey: KEY })
    if (!saved.ok) throw new Error(saved.error)
    const ask = (command: string) =>
      svc.decide(
        {
          state: { command, cwd: '/Users/me/project', os: 'darwin' },
          questions: {
            risk: {
              type: 'choice',
              instructions: 'How risky is running `command` in `cwd`?',
              criteria: {
                read_only: 'Only reads or inspects files, processes or settings. Changes nothing.',
                reversible: 'Changes files or state in a way that is easy to undo.',
                destructive: 'Deletes or overwrites data, rewrites git history, or is otherwise hard to undo.'
              }
            }
          }
        },
        { purpose: 'shell_risk', timeoutMs: 20_000 }
      )
    const bad = await ask('rm -rf ~/Documents')
    const safe = await ask('npm test')
    expect(bad.ok && safe.ok).toBe(true)
    if (!bad.ok || !safe.ok) return
    const pBad = bad.answers.risk.type === 'choice' ? bad.answers.risk.probabilities.destructive : 0
    const pSafe = safe.answers.risk.type === 'choice' ? safe.answers.risk.probabilities.destructive : 1
    console.log(`[typesafe live] destructive p: rm -rf=${pBad.toFixed(3)} npm test=${pSafe.toFixed(3)}`)
    expect(pBad).toBeGreaterThanOrEqual(0.5)
    expect(pSafe).toBeLessThan(0.5)
  }, 60_000)
})
