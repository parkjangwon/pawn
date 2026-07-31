export const DIFF_MARKER = '__DIFF__:'

export interface ParsedDiffMarker {
  filename: string
  oldText: string
  newText: string
}

const LEGACY_DIFF_RE = /<<<DIFF:(.+)>>>\n--- old\n([\s\S]*?)\n\+\+\+ new\n([\s\S]*?)<<<END>>>/

/**
 * Extract diff data from a tool message. New messages carry a one-line JSON
 * marker (`__DIFF__:{...}`); older persisted messages use the legacy
 * `<<<DIFF:...>>>` block.
 */
export function parseDiffMarker(content: string): ParsedDiffMarker | null {
  const markerIdx = content.indexOf(DIFF_MARKER)
  if (markerIdx >= 0) {
    const diffJson = content.slice(markerIdx + DIFF_MARKER.length).split('\n')[0]
    try {
      const parsed = JSON.parse(diffJson)
      if (parsed && typeof parsed.filename === 'string') {
        return {
          filename: parsed.filename,
          oldText: parsed.oldText ?? '',
          newText: parsed.newText ?? ''
        }
      }
    } catch {
      // Fall through to the legacy marker.
    }
  }
  const legacy = content.match(LEGACY_DIFF_RE)
  if (legacy) {
    return {
      filename: legacy[1],
      oldText: legacy[2],
      // The block's trailing newline belongs to the <<<END>>> delimiter.
      newText: legacy[3].replace(/\n$/, '')
    }
  }
  return null
}

/** Remove the diff marker so only the human-readable tool output remains. */
export function stripDiffMarker(content: string): string {
  const markerIdx = content.indexOf(DIFF_MARKER)
  if (markerIdx >= 0) return content.slice(0, markerIdx).trim()
  const legacy = content.match(LEGACY_DIFF_RE)
  return legacy ? content.replace(legacy[0], '').trim() : content
}
