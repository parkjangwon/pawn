import { getModRuntime, type ModRuntimeContext, type ModSourcePayload } from './runtime'
import type { LoadedModInfo } from './types'
import { useModsUiStore } from './uiStore'

let loadPromise: Promise<LoadedModInfo[]> | null = null
let lastKey = ''
let lastSessionId: string | null = null

/**
 * Mods belong to the open project, not to one chat. Discovery only depends on
 * the project path, and a reload re-imports every module (fresh state), so a
 * chat switch must not reload: it only retargets the context and clears the
 * per-chat chrome (panes, toasts, log). Settings and the chip call
 * `reloadMods` when the set of mods really changes.
 */
export function modsLoadKey(ctx: Pick<ModRuntimeContext, 'projectPath'>): string {
  return ctx.projectPath || ''
}

export async function ensureModsLoaded(ctx: ModRuntimeContext): Promise<LoadedModInfo[]> {
  const runtime = getModRuntime()
  runtime.setContext(ctx)
  const key = modsLoadKey(ctx)
  // 'pending' is the home composer before a chat exists; the first send turns
  // it into a real id, which is the same conversation, not a switch.
  const chatChanged =
    lastSessionId !== null &&
    lastSessionId !== 'pending' &&
    ctx.sessionId !== 'pending' &&
    lastSessionId !== ctx.sessionId
  lastSessionId = ctx.sessionId
  if (loadPromise && lastKey === key) {
    if (chatChanged) useModsUiStore.getState().clearChatUi()
    return loadPromise
  }

  lastKey = key
  // Preload (chat chrome) and the first send can race on a project switch:
  // run loads one after another so two runtime.load() calls never interleave.
  const previous = loadPromise
  loadPromise = (async () => {
    if (previous) await previous.catch(() => [])
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
  lastSessionId = null
}
