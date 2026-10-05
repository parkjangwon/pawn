import { handleTrusted } from './trust'
import {
  discoverMods,
  formatValidateReport,
  getModsSettings,
  installExampleMod,
  listModsSummary,
  loadEnabledModSources,
  setModsSettings,
  validateModPath,
  type ModsSettings
} from '../mods'
import { modHttpFetch, type ModHttpInit } from '../mods/http'

export function registerModsIpc(): void {
  handleTrusted('mods:settings', async () => getModsSettings())

  handleTrusted('mods:setSettings', async (_e, partial: Partial<ModsSettings>) => {
    return setModsSettings(partial || {})
  })

  handleTrusted('mods:list', async (_e, projectPath?: string | null) => {
    return { ok: true, mods: listModsSummary(projectPath ?? null) }
  })

  handleTrusted('mods:loadSources', async (_e, projectPath?: string | null) => {
    const settings = getModsSettings()
    const mods = discoverMods({ projectPath: projectPath ?? null, settings })
    const sources = loadEnabledModSources(mods)
    return {
      ok: true,
      settings,
      mods: mods.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        root: m.root,
        source: m.source,
        enabled: m.enabled,
        consented: m.consented,
        consentStale: m.consentStale,
        tier: m.tier,
        moduleRelative: m.moduleRelative,
        userConfig: m.userConfig
      })),
      sources: sources.map((s) => ({
        id: s.mod.id,
        name: s.mod.name,
        root: s.mod.root,
        tier: s.mod.tier,
        source: s.source,
        language: s.language,
        userConfig: s.mod.userConfig
      }))
    }
  })

  handleTrusted('mods:validate', async (_e, path: string) => {
    const report = validateModPath(typeof path === 'string' ? path : '')
    return {
      ok: report.ok,
      report,
      text: formatValidateReport(report)
    }
  })

  handleTrusted('mods:envSnapshot', async () => {
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v !== 'string') continue
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k)) continue
      values[k] = v.length > 32_768 ? v.slice(0, 32_768) : v
    }
    return { ok: true, values }
  })

  handleTrusted('mods:http', async (_e, url: string, init?: ModHttpInit) => {
    return modHttpFetch(typeof url === 'string' ? url : '', init)
  })

  handleTrusted('mods:installExample', async () => {
    const result = installExampleMod()
    if (!result.ok) return result
    // Do not auto-consent; Settings will walk the user through review.
    const settings = getModsSettings()
    const disabled = settings.disabledPlugins.filter((n) => n.toLowerCase() !== 'first-mod')
    setModsSettings({ disabledPlugins: [...disabled, 'first-mod'] })
    return { ...result, settings: getModsSettings() }
  })
}
