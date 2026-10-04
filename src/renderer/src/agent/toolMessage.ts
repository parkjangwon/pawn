import { DIFF_MARKER } from '../utils/diffMarker'

// Per-side cap for diff text embedded in tool messages; bounds DB row size.
export const DIFF_TEXT_CAP = 50000

/** Row size cap for the human-readable part of a tool message. */
export const TOOL_ROW_CAP = 500

export interface ToolDiffData {
  filename: string
  oldText: string
  newText: string
  path?: string
}

/**
 * Machine-readable marker appended to a tool row when the full output was
 * offloaded (`read_output`-able). Same pattern as `__DIFF__:`: the model-facing
 * transcript keeps the prose note, while the persisted UI row carries the id +
 * size in JSON that ToolMessage parses to offer "load full output" paging.
 */
export const OFFLOAD_MARKER = '__OFFLOAD__:'

export interface OffloadedOutput {
  /** Offload store id (`out_…`) — readable via `read_output` / toolOutput:get. */
  id: string
  /** Full output size in chars (as measured before truncation). */
  chars: number
}

/**
 * The model-facing note chatLoop appends to a truncated tool result:
 * `[full output: 12,345 chars saved — read_output {"id":"out_ab12cd34"} to page, grep or tail it]`
 */
const OFFLOAD_NOTE_RE =
  /\n?\[full output:\s*([\d,]+) chars saved[^\]]*read_output\s*\{"id":"([^"]+)"\}[^\]]*\]\s*$/

/**
 * Detect the offload note at the end of a truncated tool result and split it
 * off. Returns null when the result was not offloaded.
 */
export function parseOffloadNote(truncated: string): { stripped: string; offloaded: OffloadedOutput } | null {
  const m = OFFLOAD_NOTE_RE.exec(truncated)
  if (!m) return null
  const chars = Number(m[1].replace(/,/g, ''))
  const id = m[2]
  if (!id || !Number.isFinite(chars)) return null
  return { stripped: truncated.slice(0, m.index), offloaded: { id, chars } }
}

/** Read the `__OFFLOAD__:` marker back from a persisted tool row. */
export function parseOffloadMarker(content: string): OffloadedOutput | null {
  const idx = content.indexOf(OFFLOAD_MARKER)
  if (idx < 0) return null
  const json = content.slice(idx + OFFLOAD_MARKER.length).split('\n')[0]
  try {
    const parsed = JSON.parse(json) as Partial<OffloadedOutput>
    if (typeof parsed?.id === 'string' && typeof parsed?.chars === 'number') {
      return { id: parsed.id, chars: parsed.chars }
    }
  } catch {
    // Malformed marker — treat as absent.
  }
  return null
}

/** Remove the `__OFFLOAD__:` marker so only human-readable output remains. */
export function stripOffloadMarker(content: string): string {
  const idx = content.indexOf(OFFLOAD_MARKER)
  if (idx < 0) return content
  return content.slice(0, idx).replace(/\n+$/, '')
}

/**
 * Build the display content for a tool system message. Diff data is appended as
 * a one-line JSON marker that DiffView consumers parse via `parseDiffMarker`.
 *
 * When the truncated result ends with the model-facing offload note, the note
 * is stripped from the persisted row (the transcript keeps it untouched) and
 * replaced with the machine-readable `__OFFLOAD__:` marker, which ToolMessage
 * turns into a localized note plus a paged "load full output" view.
 */
export function formatToolMessageContent(
  name: string,
  isError: boolean,
  truncated: string,
  diffData?: ToolDiffData
): string {
  const offload = parseOffloadNote(truncated)
  const visible = (offload ? offload.stripped : truncated).slice(0, TOOL_ROW_CAP)
  return (
    `[Tool: ${name}] ${isError ? 'ERROR' : 'OK'}\n${visible}${
      diffData
        ? `\n${DIFF_MARKER}${JSON.stringify({
            filename: diffData.filename,
            path: diffData.path || '',
            oldText: diffData.oldText.slice(0, DIFF_TEXT_CAP),
            newText: diffData.newText.slice(0, DIFF_TEXT_CAP)
          })}`
        : ''
    }${
      offload
        ? `\n${OFFLOAD_MARKER}${JSON.stringify({ id: offload.offloaded.id, chars: offload.offloaded.chars })}`
        : ''
    }`
  )
}
