import { getModRuntime } from './runtime'
import { modEventLabel } from './eventLabel'
import { useModsUiStore } from './uiStore'

/** Button / Input / Select / slot click → the owning mod, then one redraw. */
export async function emitModUi(
  event: 'ui.press' | 'ui.input' | 'ui.select',
  plugin: string | undefined,
  payload: Record<string, unknown>
): Promise<void> {
  const generation = useModsUiStore.getState().renderGeneration
  await getModRuntime()
    .emit(event, { plugin: plugin || '', ...payload }, async (e) => e)
    .catch(() => {})
  const label =
    event !== 'ui.input' && typeof payload.value === 'string' && payload.value.trim()
      ? payload.value.trim()
      : typeof payload.id === 'string'
        ? payload.id
        : modEventLabel(event)
  const text =
    event === 'ui.input'
      ? `Edited ${label}.`
      : event === 'ui.select'
        ? `Chose ${label}.`
        : `Pressed ${label}.`
  useModsUiStore.getState().pushTimeline(plugin || 'extension', text, 'press')
  if (useModsUiStore.getState().renderGeneration === generation) {
    useModsUiStore.getState().invalidate()
  }
}

export function pressModSlot(
  plugin: string,
  id: string,
  slot: string,
  extra?: Record<string, unknown>
): Promise<void> {
  return emitModUi('ui.press', plugin, { id, slot, ...extra })
}
