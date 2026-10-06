/** Claude Code–compatible mods (in-process JS/TS event hooks). */

export interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: { name?: string; email?: string }
  userConfig?: Record<string, unknown>
}

export interface HooksModuleManifest {
  description?: string
  /** Paths relative to hooks.json — presence of `modules` makes a plugin a mod. */
  modules?: string[]
  hooks?: Record<string, unknown>
}

export type ModTier = 'prepend' | 'user' | 'append' | 'builtin'

export interface DiscoveredMod {
  id: string
  name: string
  version: string
  description: string
  root: string
  /** Absolute path to the hooks module entry (first modules[] entry). */
  modulePath: string
  moduleRelative: string
  /** Every resolvable hooks module entry, first first. */
  modulePaths: string[]
  moduleRelatives: string[]
  tier: ModTier
  source: 'pawn' | 'claude' | 'plugin-dir' | 'project' | 'builtin'
  enabled: boolean
  /** User has reviewed hooks/calls and allowed this mod to run (for this version). */
  consented: boolean
  /** Consent exists for the name but not this version — needs re-review. */
  consentStale: boolean
  userConfig: Record<string, unknown>
}

export interface ModMultiSource {
  mod: DiscoveredMod
  /** One entry per resolvable hooks module, in hooks.json order. */
  sources: string[]
  language: 'js' | 'ts'
}

export interface ModConsentEntry {
  name: string
  /** Exact version allowed; `*` = any (legacy string consent). */
  version: string
}

export interface ModsSettings {
  /** Master switch for mods (settings hooks use hooks.enabled separately when disableAllHooks is false). */
  enabled: boolean
  /**
   * Claude Code `disableAllHooks`: when true, installed mods do not load.
   * Settings hooks are gated by hooks.enabled in parallel.
   */
  disableAllHooks: boolean
  /** Plugin names the user disabled in Settings. */
  disabledPlugins: string[]
  /**
   * Plugins the user explicitly allowed after reviewing capabilities.
   * `null` = legacy settings file without the key (trust previously enabled mods).
   */
  consentedPlugins: ModConsentEntry[] | null
  /** Absolute directories loaded like `--plugin-dir` (persist across sessions). */
  pluginDirs: string[]
  /** Also scan Claude Code installed plugins for hooks modules. Default off. */
  readClaudePlugins: boolean
  /**
   * Plugin names in execution order (earlier runs first within a tier).
   * Names missing from the list keep discovery order after the listed ones.
   */
  pluginOrder: string[]
}

export const DEFAULT_MODS_SETTINGS: ModsSettings = {
  enabled: true,
  disableAllHooks: false,
  disabledPlugins: [],
  consentedPlugins: [],
  pluginDirs: [],
  readClaudePlugins: false,
  pluginOrder: []
}

export interface ModValidateFinding {
  severity: 'error' | 'warning'
  message: string
  file?: string
}

export interface ModValidateReport {
  ok: boolean
  mod?: Pick<DiscoveredMod, 'name' | 'root' | 'moduleRelative'>
  hooks: string[]
  calls: string[]
  envReads: string[]
  envWrites: string[]
  findings: ModValidateFinding[]
}
