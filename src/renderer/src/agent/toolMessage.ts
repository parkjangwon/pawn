import { DIFF_MARKER } from '../utils/diffMarker'

// Per-side cap for diff text embedded in tool messages; bounds DB row size.
export const DIFF_TEXT_CAP = 50000

export interface ToolDiffData {
  filename: string
  oldText: string
  newText: string
}

/**
 * Build the display content for a tool system message. Diff data is appended as
 * a one-line JSON marker that DiffView consumers parse via `parseDiffMarker`.
 */
export function formatToolMessageContent(
  name: string,
  isError: boolean,
  truncated: string,
  diffData?: ToolDiffData
): string {
  return `[Tool: ${name}] ${isError ? 'ERROR' : 'OK'}\n${truncated.slice(0, 500)}${
    diffData
      ? `\n${DIFF_MARKER}${JSON.stringify({
          filename: diffData.filename,
          oldText: diffData.oldText.slice(0, DIFF_TEXT_CAP),
          newText: diffData.newText.slice(0, DIFF_TEXT_CAP)
        })}`
      : ''
  }`
}
