/**
 * Mods write `props.suffix` with their own leading separator (" · tool
 * calls: 3…" in first-mod), while the chat draws its own
 * " · " before it. Strip the mod's lead, a trailing ellipsis ('…' or
 * '...'), and trailing whitespace so the line reads "Thinking… · tool calls: 3".
 */
export function formatModSpinnerSuffix(raw: string): string {
  return String(raw || '')
    .replace(/^[\s·•|:\-–—]+/, '')
    .replace(/(?:\.{3}|…)\s*$/, '')
    .trim()
}
