/**
 * Headless provider config: ~/.pawn/config.toml (or a JSON file), with API
 * keys from the environment. Keys encrypted by the desktop app (OS keychain)
 * cannot be decrypted outside Electron, so they must come from env vars.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { HeadlessConfig } from './nodeApi'

const HOST_ENV: Array<[RegExp, string]> = [
  [/api\.openai\.com/i, 'OPENAI_API_KEY'],
  [/anthropic\.com/i, 'ANTHROPIC_API_KEY'],
  [/deepseek\.com/i, 'DEEPSEEK_API_KEY'],
  [/openrouter\.ai/i, 'OPENROUTER_API_KEY'],
  [/generativelanguage\.googleapis\.com/i, 'GEMINI_API_KEY'],
  [/api\.x\.ai/i, 'XAI_API_KEY'],
  [/groq\.com/i, 'GROQ_API_KEY'],
  [/mistral\.ai/i, 'MISTRAL_API_KEY'],
  [/xiaomimimo\.com/i, 'MIMO_API_KEY'],
  [/opencode\.ai/i, 'OPENCODE_API_KEY'],
  [/commandcode\.ai/i, 'COMMANDCODE_API_KEY']
]

export function envKeyName(providerId: string): string {
  return `PAWN_API_KEY_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

/** Fill provider keys from env; disable providers left without a usable key. */
export function applyEnvKeys(cfg: HeadlessConfig, env: Record<string, string | undefined> = process.env): {
  config: HeadlessConfig
  missing: string[]
} {
  const missing: string[] = []
  const providers = (cfg.providers || []).map((p) => {
    const id = String(p.id || '')
    const base = String(p.baseUrl || '')
    let key = typeof p.apiKey === 'string' ? p.apiKey : ''
    if (key.startsWith('enc:')) key = ''
    const byId = env[envKeyName(id)]
    const byHost = HOST_ENV.find(([re]) => re.test(base))?.[1]
    key = byId || key || (byHost ? env[byHost] || '' : '')
    const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(base)
    // Kiro signs in through its own service (KIRO_API_KEY or the Kiro CLI login).
    const usable = !!key || local || p.apiFormat === 'kiro'
    if (p.enabled !== false && !usable) missing.push(`${p.name || id} (${envKeyName(id)}${byHost ? ` or ${byHost}` : ''})`)
    return { ...p, apiKey: key, enabled: p.enabled !== false && usable }
  })
  return { config: { ...cfg, providers }, missing }
}

export async function loadHeadlessConfig(path?: string): Promise<{ config: HeadlessConfig; missing: string[] }> {
  let raw: HeadlessConfig
  if (path) {
    raw = JSON.parse(readFileSync(path, 'utf8')) as HeadlessConfig
  } else {
    const { loadConfig, getPawnDir } = await import('../main/config')
    raw = loadConfig() as unknown as HeadlessConfig
    const decisionPath = join(getPawnDir(), 'decision.json')
    if (existsSync(decisionPath)) {
      try {
        raw.decision = JSON.parse(readFileSync(decisionPath, 'utf8')) as Record<string, unknown>
      } catch {
        /* unreadable: run without decision models */
      }
    }
  }
  const out = applyEnvKeys(raw)
  if (out.config.decision) out.config.decision = applyDecisionEnvKeys(out.config.decision)
  return out
}

const DECISION_KEY_ENV: Record<string, string> = {
  typesafe: 'TYPESAFE_API_KEY',
  ollaya: 'OLLAYA_API_KEY',
  custom: 'PAWN_DECISION_API_KEY'
}

/**
 * Decision-provider keys sealed by the desktop app can't be opened outside
 * Electron: take them from TYPESAFE_API_KEY / OLLAYA_API_KEY /
 * PAWN_DECISION_API_KEY. A hosted provider left without a key is disabled.
 */
export function applyDecisionEnvKeys(
  decision: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env
): Record<string, unknown> {
  const providers = (Array.isArray(decision.providers) ? decision.providers : []).map((p: Record<string, unknown>) => {
    let key = typeof p.apiKey === 'string' ? p.apiKey : ''
    if (key.startsWith('enc:')) key = ''
    const kind = typeof p.kind === 'string' ? p.kind : 'custom'
    key = key || env[DECISION_KEY_ENV[kind] || 'PAWN_DECISION_API_KEY'] || ''
    const local = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(String(p.baseUrl || ''))
    const usable = !!key || local || kind !== 'typesafe'
    return { ...p, apiKey: key || undefined, enabled: p.enabled === true && usable }
  })
  return { ...decision, providers }
}
