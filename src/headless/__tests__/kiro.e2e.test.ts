/**
 * Live Kiro E2E through the real agent loop (skipped unless PAWN_KIRO_E2E=1).
 * Uses KIRO_API_KEY when set, otherwise the local Kiro CLI / IDE login
 * (read-only — never refreshed). Consumes a few Kiro credits.
 */
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runHeadlessTurn } from '../runner'
import type { HeadlessConfig } from '../nodeApi'

const LIVE = process.env.PAWN_KIRO_E2E === '1'
const MODEL = process.env.PAWN_KIRO_MODEL || 'claude-haiku-4.5'

const config: HeadlessConfig = {
  settings: { routingMode: 'manual', activeModelId: 'kiro-live', doneGate: 'off', smartCompaction: false },
  providers: [{ id: 'kiro', name: 'Kiro', apiFormat: 'kiro', baseUrl: 'https://q.us-east-1.amazonaws.com', enabled: true }],
  models: [{ id: 'kiro-live', providerId: 'kiro', modelId: MODEL, label: `${MODEL} (Kiro)`, tier: 'low', enabled: true, supportsTools: true, supportsVision: true, contextWindow: 200_000 }]
}

describe.skipIf(!LIVE)('Kiro provider (live, PAWN_KIRO_E2E=1)', () => {
  it('lists models and reports credits', async () => {
    const { createNodeApi } = await import('../nodeApi')
    const { api, dispose } = createNodeApi({ config })
    try {
      const status = await api.kiro.status()
      expect(status.signedIn).toBe(true)
      const models = await api.kiro.models()
      expect(models.ok).toBe(true)
      expect(models.models.some((m: { modelId: string }) => m.modelId === MODEL)).toBe(true)
      const usage = await api.kiro.usage()
      expect(usage.ok).toBe(true)
    } finally {
      dispose()
    }
  }, 60_000)

  it('fixes a failing test with multi-turn tool use', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pawn-kiro-live-'))
    try {
      await mkdir(join(dir, 'src'))
      await mkdir(join(dir, 'test'))
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'k', type: 'module', scripts: { test: 'node --test' } }))
      await writeFile(join(dir, 'src', 'max.js'), 'export function max(xs) {\n  let m = 0\n  for (const x of xs) if (x > m) m = x\n  return m\n}\n')
      await writeFile(
        join(dir, 'test', 'max.test.js'),
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { max } from '../src/max.js'\ntest('negatives', () => assert.equal(max([-5, -2, -9]), -2))\ntest('positives', () => assert.equal(max([1, 7, 3]), 7))\n"
      )
      const res = await runHeadlessTurn({ prompt: 'npm test fails. Fix src/max.js (not the tests) and confirm the tests pass.', cwd: dir, config, permission: 'yolo', timeoutMs: 240_000 })
      expect(res.outcome).toBe('completed')
      expect(res.tools.length).toBeGreaterThan(1)
      expect(res.models[0]).toContain('(Kiro)')
      expect(await readFile(join(dir, 'src', 'max.js'), 'utf8')).not.toMatch(/let m = 0\b/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
