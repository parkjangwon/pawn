import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'
import type { HooksSettings } from './types'
import { DEFAULT_HOOKS_SETTINGS } from './types'

function settingsPath(): string {
  return join(getPawnDir(), 'hooks-settings.json')
}

export function getHooksSettings(): HooksSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULT_HOOKS_SETTINGS }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<HooksSettings>
    return {
      enabled: raw.enabled !== false,
      readClaude: raw.readClaude !== false,
      readPawn: raw.readPawn !== false
    }
  } catch {
    return { ...DEFAULT_HOOKS_SETTINGS }
  }
}

export function setHooksSettings(partial: Partial<HooksSettings>): HooksSettings {
  const next = { ...getHooksSettings(), ...partial }
  const dir = getPawnDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
