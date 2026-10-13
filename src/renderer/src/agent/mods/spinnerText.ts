/**
 * Mods write `props.suffix` with their own leading separator (" · tool
 * calls: 3…" in first-mod), while the chat draws its own
 * " · " before it. Strip the mod's lead so the line reads "Thinking… · x".
 */
export function formatModSpinnerSuffix(raw: string): string {
  return String(raw || '')
    .replace(/^[\s·•|:\-–—]+/, '')
    .trim()
}
