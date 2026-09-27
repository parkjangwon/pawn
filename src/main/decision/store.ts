/**
 * Decision-provider config at ~/.pawn/decision.json (0600). API keys are
 * sealed with the OS keychain (safeStorage) like BYOK provider keys; the
 * renderer only ever sees `hasKey` / a 4-char hint.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'
import { decryptApiKey, encryptApiKey } from '../providerSecrets'
import type { DecisionStore } from './service'
import { emptyDecisionConfig, type DecisionConfig } from './types'

export function decisionConfigPath(dir = getPawnDir()): string {
  return join(dir, 'decision.json')
}

export function createFileDecisionStore(dir = getPawnDir()): DecisionStore {
  const path = decisionConfigPath(dir)
  return {
    load(): DecisionConfig {
      if (!existsSync(path)) return emptyDecisionConfig()
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as DecisionConfig
        return {
          ...raw,
          providers: (Array.isArray(raw.providers) ? raw.providers : []).map((p) => ({
            ...p,
            apiKey: decryptApiKey(p.apiKey) || undefined
          }))
        }
      } catch {
        return emptyDecisionConfig()
      }
    },
    save(cfg: DecisionConfig): void {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const sealed: DecisionConfig = {
        ...cfg,
        providers: cfg.providers.map((p) => ({ ...p, apiKey: encryptApiKey(p.apiKey) || undefined }))
      }
      writeFileSync(path, JSON.stringify(sealed, null, 2), { encoding: 'utf8', mode: 0o600 })
      try {
        chmodSync(path, 0o600)
      } catch {
        /* best effort (Windows) */
      }
    }
  }
}
