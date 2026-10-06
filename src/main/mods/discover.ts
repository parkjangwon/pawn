import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { getPawnDir } from '../config'
import { getModsSettings, isModConsented, isModConsentStale, modsAllowed } from './settings'
import type {
  DiscoveredMod,
  HooksModuleManifest,
  ModTier,
  PluginManifest
} from './types'

/** Earlier names run first. Unlisted mods keep their relative discovery order. */
export function sortModsByOrder<T extends { name: string }>(mods: T[], order: string[]): T[] {
  if (!order.length) return mods
  const rank = new Map(order.map((n, i) => [n.toLowerCase(), i]))
  return [...mods].sort((a, b) => {
    const ra = rank.get(a.name.toLowerCase())
    const rb = rank.get(b.name.toLowerCase())
    const ia = ra === undefined ? Number.MAX_SAFE_INTEGER : ra
    const ib = rb === undefined ? Number.MAX_SAFE_INTEGER : rb
    return ia - ib
  })
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function listDirs(root: string): string[] {
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name))
  } catch {
    return []
  }
}

const MODULE_EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']

export function resolveModule(hooksDir: string, rel: string): { abs: string; relative: string } | null {
  const cleaned = rel.replace(/^\.\//, '')
  const abs = resolve(hooksDir, cleaned)
  if (existsSync(abs) && statSync(abs).isFile()) {
    return { abs, relative: cleaned }
  }
  for (const ext of MODULE_EXTS) {
    if (cleaned.endsWith(ext)) continue
    const candidate = abs + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { abs: candidate, relative: cleaned + ext }
    }
  }
  return null
}

/** True when a plugin directory is a mod (hooks/hooks.json has modules[]). */
export function inspectModDir(
  root: string,
  meta: { tier: ModTier; source: DiscoveredMod['source']; enabled: boolean; consented: boolean }
): DiscoveredMod | null {
  const manifest = readJson<PluginManifest>(join(root, '.claude-plugin', 'plugin.json'))
    || readJson<PluginManifest>(join(root, '.pawn-plugin', 'plugin.json'))
  const hooksJson = readJson<HooksModuleManifest>(join(root, 'hooks', 'hooks.json'))
  if (!hooksJson?.modules?.length) return null

  const name = (manifest?.name || basename(root)).trim()
  if (!name) return null

  const hooksDir = join(root, 'hooks')
  const first = resolveModule(hooksDir, hooksJson.modules[0])
  if (!first) return null

  const paths: string[] = [first.abs]
  const relatives: string[] = [first.relative]
  for (let i = 1; i < hooksJson.modules.length; i++) {
    const extra = resolveModule(hooksDir, hooksJson.modules[i])
    if (extra && !paths.includes(extra.abs)) {
      paths.push(extra.abs)
      relatives.push(extra.relative)
    }
  }

  return {
    id: `${name}@${meta.source}`,
    name,
    version: manifest?.version || '0.0.0',
    description: manifest?.description || hooksJson.description || '',
    root,
    modulePath: first.abs,
    moduleRelative: first.relative,
    modulePaths: paths,
    moduleRelatives: relatives,
    tier: meta.tier,
    source: meta.source,
    enabled: meta.enabled,
    consented: meta.consented,
    consentStale: false,
    userConfig: {}
  }
}

function scanPluginContainer(
  container: string,
  meta: { tier: ModTier; source: DiscoveredMod['source']; enabled: boolean; consented: boolean }
): DiscoveredMod[] {
  const out: DiscoveredMod[] = []
  for (const dir of listDirs(container)) {
    const mod = inspectModDir(dir, meta)
    if (mod) out.push(mod)
  }
  // Also allow the container itself to be a single mod directory.
  const self = inspectModDir(container, meta)
  if (self) out.push(self)
  return out
}

function claudeInstalledPluginRoots(): string[] {
  const home = homedir()
  const manifestPath = join(home, '.claude', 'plugins', 'installed_plugins.json')
  const manifest = readJson<{ plugins?: Record<string, Array<{ scope?: string; installPath?: string }>> }>(
    manifestPath
  )
  if (!manifest?.plugins) return []
  const seen = new Set<string>()
  const roots: string[] = []
  for (const installs of Object.values(manifest.plugins)) {
    for (const inst of installs || []) {
      if (inst.scope === 'user' && inst.installPath && !seen.has(inst.installPath)) {
        seen.add(inst.installPath)
        roots.push(inst.installPath)
      }
    }
  }
  return roots
}

/**
 * Discover every mod the session may load.
 * Order: pluginDirs → ~/.pawn/mods → Claude installs → project plugins.
 */
export function discoverMods(opts?: {
  projectPath?: string | null
  settings?: ReturnType<typeof getModsSettings>
  /** When true, still list mods even if the master switch is off (Settings UI). */
  forSettings?: boolean
}): DiscoveredMod[] {
  const settings = opts?.settings || getModsSettings()
  if (!opts?.forSettings && !modsAllowed(settings)) return []

  const disabled = new Set(settings.disabledPlugins.map((n) => n.toLowerCase()))
  const found: DiscoveredMod[] = []
  const seenRoots = new Set<string>()

  const resolveFlags = (
    name: string,
    version: string
  ): { enabled: boolean; consented: boolean; consentStale: boolean } => {
    const consented = isModConsented(name, version, settings)
    const consentStale = isModConsentStale(name, version, settings)
    const notDisabled = !disabled.has(name.toLowerCase())
    const masterOn = modsAllowed(settings)
    return {
      consented,
      consentStale,
      enabled: masterOn && notDisabled && consented
    }
  }

  const push = (mod: DiscoveredMod | null): void => {
    if (!mod) return
    const key = resolve(mod.root)
    if (seenRoots.has(key)) return
    seenRoots.add(key)
    const flags = resolveFlags(mod.name, mod.version)
    found.push({ ...mod, ...flags })
  }

  for (const dir of settings.pluginDirs) {
    for (const mod of scanPluginContainer(dir, {
      tier: 'user',
      source: 'plugin-dir',
      enabled: true,
      consented: true
    })) {
      push(mod)
    }
  }

  for (const mod of scanPluginContainer(join(getPawnDir(), 'mods'), {
    tier: 'user',
    source: 'pawn',
    enabled: true,
    consented: true
  })) {
    push(mod)
  }

  if (settings.readClaudePlugins || opts?.forSettings) {
    // When listing for settings with scan off, still show nothing from Claude.
    if (settings.readClaudePlugins) {
      for (const root of claudeInstalledPluginRoots()) {
        push(inspectModDir(root, { tier: 'user', source: 'claude', enabled: true, consented: true }))
      }
    }
  }

  const projectPath = opts?.projectPath?.trim()
  if (projectPath) {
    const projPlugins = join(projectPath, '.claude', 'plugins')
    for (const mod of scanPluginContainer(projPlugins, {
      tier: 'user',
      source: 'project',
      enabled: true,
      consented: true
    })) {
      push(mod)
    }
  }

  return sortModsByOrder(found, settings.pluginOrder || [])
}

export function listModsSummary(projectPath?: string | null): Array<{
  id: string
  name: string
  version: string
  description: string
  root: string
  source: DiscoveredMod['source']
  enabled: boolean
  consented: boolean
  consentStale: boolean
  tier: ModTier
}> {
  return discoverMods({ projectPath, forSettings: true }).map((m) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    root: m.root,
    source: m.source,
    enabled: m.enabled,
    consented: m.consented,
    consentStale: m.consentStale,
    tier: m.tier
  }))
}
