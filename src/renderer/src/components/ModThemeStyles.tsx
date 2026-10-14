import { useMemo } from 'react'
import { useModsUiStore } from '../agent/mods/uiStore'
import { buildModThemeCss } from '../agent/mods/theme'

/** One <style> carrying every mod's theme vars and scoped sheets. Rendered after the app CSS so it wins. */
export default function ModThemeStyles(): React.JSX.Element | null {
  const themes = useModsUiStore((s) => s.themes)
  const off = useModsUiStore((s) => s.themeOff)
  const css = useMemo(() => buildModThemeCss(themes, off), [themes, off])
  if (!css) return null
  return <style data-mod-theme="">{css}</style>
}
