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

function chatSwitch(ctx: ModRuntimeContext): boolean {
  // 'pending' is the home composer before a chat exists; the first send turns
  // it into a real id, which is the same conversation, not a switch.
  return (
    lastSessionId !== null &&
    lastSessionId !== 'pending' &&
    ctx.sessionId !== 'pending' &&
    lastSessionId !== ctx.sessionId
  )
}

/** Retarget the open chat. Call only after any in-flight load has settled. */
function retarget(ctx: ModRuntimeContext): void {
  const switched = chatSwitch(ctx)
  lastSessionId = ctx.sessionId
  getModRuntime().setContext(ctx)
  if (switched) useModsUiStore.getState().clearChatUi()
}

export async function ensureModsLoaded(ctx: ModRuntimeContext): Promise<LoadedModInfo[]> {
  const key = modsLoadKey(ctx)
  // Same project: join the in-flight (or finished) load, then retarget.
  // A reload may replace the promise while we wait; loop and join that one.
  while (loadPromise && lastKey === key) {
    const pending = loadPromise
    await pending.catch(() => [])
    if (loadPromise === pending && lastKey === key) {
      retarget(ctx)
      return getModRuntime().getLoaded()
    }
  }

  const previous = loadPromise
  const runtime = getModRuntime()
  // loadPromise is set before this function awaits. The loader itself awaits
  // `previous` first, so two runtime.load() calls never interleave.
  const mine = (async (): Promise<LoadedModInfo[]> => {
    if (previous) await previous.catch(() => [])
    retarget(ctx)
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
  loadPromise = mine
  lastKey = key

  let failed = false
  try {
    return await mine
  } catch {
    failed = true
    return []
  } finally {
    if (failed && loadPromise === mine) loadPromise = null
  }
}

export async function reloadMods(ctx: ModRuntimeContext): Promise<LoadedModInfo[]> {
  // Do not clear loadPromise: a reload must run after any in-flight load.
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
