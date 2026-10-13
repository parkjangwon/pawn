import { getModRuntime } from './runtime'
import { useModsUiStore } from './uiStore'

export { formatModSpinnerSuffix } from './spinnerText'

/**
 * Keep the spinner suffix current. The suffix used to be computed only after
 * a tool finished, so a turn started with no suffix, and `$.ui.invalidate()`
 * (first-mod calls it on every tool.call and on reset) never redrew it.
 * Recompute on every runtime (load/unload) and render generation.
 */
export function watchModSpinnerSuffix(): () => void {
  let lastRender = -1
  let lastRuntime = -1
  const refresh = (): void => {
    void getModRuntime()
      .refreshSpinnerSuffix()
      .catch(() => {})
  }
  const onState = (s: { renderGeneration: number; runtimeGeneration: number }): void => {
    if (s.renderGeneration === lastRender && s.runtimeGeneration === lastRuntime) return
    lastRender = s.renderGeneration
    lastRuntime = s.runtimeGeneration
    refresh()
  }
  onState(useModsUiStore.getState())
  return useModsUiStore.subscribe(onState)
}
