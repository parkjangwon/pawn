import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'
import { DEFAULT_MODS_SETTINGS, type ModConsentEntry, type ModsSettings } from './types'

function settingsPath(): string {
  return join(getPawnDir(), 'mods-settings.json')
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

/** Accept legacy `string[]` or `{ name, version }[]`. */
export function normalizeConsentList(raw: unknown): ModConsentEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ModConsentEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    let name = ''
    let version = '*'
    if (typeof item === 'string' && item.trim()) {
      name = item.trim()
      version = '*'
    } else if (item && typeof item === 'object') {
      const o = item as { name?: unknown; version?: unknown }
      if (typeof o.name === 'string' && o.name.trim()) {
        name = o.name.trim()
        version = typeof o.version === 'string' && o.version.trim() ? o.version.trim() : '*'
      }
    }
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) {
      // Prefer a concrete version over wildcard when duplicates appear.
      const idx = out.findIndex((e) => e.name.toLowerCase() === key)
      if (idx >= 0 && out[idx].version === '*' && version !== '*') out[idx] = { name: out[idx].name, version }
      continue
    }
    seen.add(key)
    out.push({ name, version })
  }
  return out
}

function normalize(raw: Partial<ModsSettings> | null | undefined, legacyConsent: boolean): ModsSettings {
  const disabled = stringList(raw?.disabledPlugins)
  const dirs = stringList(raw?.pluginDirs)
  const consented = legacyConsent ? null : normalizeConsentList(raw?.consentedPlugins)
  return {
    enabled: raw?.enabled !== false,
    disableAllHooks: raw?.disableAllHooks === true,
    disabledPlugins: Array.from(new Set(disabled)),
    consentedPlugins: consented,
    pluginDirs: Array.from(new Set(dirs)),
    // Default off for new installs; preserve explicit true from saved settings.
    readClaudePlugins: raw?.readClaudePlugins === true,
    pluginOrder: stringList(raw?.pluginOrder)
  }
}

export function getModsSettings(): ModsSettings {
  const p = settingsPath()
  if (!existsSync(p)) {
    return {
      ...DEFAULT_MODS_SETTINGS,
      disabledPlugins: [],
      consentedPlugins: [],
      pluginDirs: [],
      pluginOrder: []
    }
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<ModsSettings> & Record<string, unknown>
    const legacyConsent = !Object.prototype.hasOwnProperty.call(raw, 'consentedPlugins')
    return normalize(raw, legacyConsent)
  } catch {
    return {
      ...DEFAULT_MODS_SETTINGS,
      disabledPlugins: [],
      consentedPlugins: [],
      pluginDirs: [],
      pluginOrder: []
    }
  }
}

export function setModsSettings(partial: Partial<ModsSettings>): ModsSettings {
  const cur = getModsSettings()
  const merged: Partial<ModsSettings> = { ...cur, ...partial }
  // Once the user writes settings, persist an explicit consented list (never leave legacy null).
  if (merged.consentedPlugins === null) merged.consentedPlugins = []
  const next = normalize(merged, false)
  const dir = getPawnDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

/** Mods may load when both the mods switch and disableAllHooks allow it. */
export function modsAllowed(settings = getModsSettings()): boolean {
  return settings.enabled && !settings.disableAllHooks
}

function findConsent(name: string, settings: ModsSettings): ModConsentEntry | undefined {
  if (!settings.consentedPlugins) return undefined
  return settings.consentedPlugins.find((n) => n.name.toLowerCase() === name.toLowerCase())
}

/** True when the user allowed this plugin name at a compatible version. */
export function isModConsented(
  name: string,
  version = '*',
  settings = getModsSettings()
): boolean {
  if (settings.consentedPlugins === null) return true
  const entry = findConsent(name, settings)
  if (!entry) return false
  if (entry.version === '*' || version === '*') return true
  return entry.version === version
}

/** Consent exists for the name but not for this version — UI should ask again. */
export function isModConsentStale(
  name: string,
  version: string,
  settings = getModsSettings()
): boolean {
  if (settings.consentedPlugins === null) return false
  const entry = findConsent(name, settings)
  if (!entry) return false
  if (entry.version === '*') return false
  return entry.version !== version
}

export function upsertConsent(
  list: ModConsentEntry[] | null | undefined,
  name: string,
  version: string
): ModConsentEntry[] {
  const base = normalizeConsentList(list || [])
  const rest = base.filter((e) => e.name.toLowerCase() !== name.toLowerCase())
  return [...rest, { name, version: version || '0.0.0' }]
}

export function removeConsent(list: ModConsentEntry[] | null | undefined, name: string): ModConsentEntry[] {
  return normalizeConsentList(list || []).filter((e) => e.name.toLowerCase() !== name.toLowerCase())
}
