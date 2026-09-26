/**
 * Headless provider config: ~/.pawn/config.toml (or a JSON file), with API
 * keys from the environment. Keys encrypted by the desktop app (OS keychain)
 * cannot be decrypted outside Electron, so they must come from env vars.
 */

import { readFileSync } from 'fs'
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
    const usable = !!key || local
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
    const { loadConfig } = await import('../main/config')
    raw = loadConfig() as unknown as HeadlessConfig
  }
  return applyEnvKeys(raw)
}
