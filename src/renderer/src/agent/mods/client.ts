import { getModRuntime, type ModRuntimeContext, type ModSourcePayload } from './runtime'
import type { LoadedModInfo } from './types'
import { useModsUiStore } from './uiStore'

let loadPromise: Promise<LoadedModInfo[]> | null = null
let lastKey = ''

export async function ensureModsLoaded(ctx: ModRuntimeContext): Promise<LoadedModInfo[]> {
  const runtime = getModRuntime()
  runtime.setContext(ctx)
  const key = `${ctx.sessionId}::${ctx.projectPath || ''}::${ctx.cwd || ''}`
  if (loadPromise && lastKey === key) return loadPromise

  lastKey = key
  loadPromise = (async () => {
    const api = window.api?.mods
    if (!api?.loadSources) {
      await runtime.load([])
      return runtime.getLoaded()
    }
    const res = await api.loadSources(ctx.projectPath ?? null).catch(() => null)
    if (!res || res.ok === false) {
      await runtime.load([])
      return runtime.getLoaded()
    }
    const sources: ModSourcePayload[] = (res.sources || []).map((s) => ({
      id: s.id,
      name: s.name,
      root: s.root,
      tier: (s.tier as ModSourcePayload['tier']) || 'user',
      sources: Array.isArray(s.sources) ? s.sources : [],
      userConfig: s.userConfig
    }))
    return runtime.load(sources)
  })()

  try {
    return await loadPromise
  } catch {
    loadPromise = null
    return []
  }
}

export async function reloadMods(ctx: ModRuntimeContext): Promise<LoadedModInfo[]> {
  loadPromise = null
  lastKey = ''
  useModsUiStore.getState().clearSessionUi()
  return ensureModsLoaded(ctx)
}

export function listActiveModLine(): string {
  const mods = getModRuntime().getActiveMods()
  if (mods.length === 0) return ''
  const names = mods.map((m) => m.name).join(', ')
  return `${mods.length} mod${mods.length === 1 ? '' : 's'} active · ${names}`
}

export function __resetModsClientForTests(): void {
  loadPromise = null
  lastKey = ''
}
