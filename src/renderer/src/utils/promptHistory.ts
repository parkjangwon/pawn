import { stripDisplayImages } from './attachments'

/** Max prompts kept per session (oldest dropped). */
export const MAX_PROMPT_HISTORY = 200

/** Extract user-typed prompts from session messages (oldest → newest). */
export function collectUserPrompts(
  messages: Array<{ role: string; content: string }>
): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.role !== 'user') continue
    const text = stripDisplayImages(m.content).trim()
    if (text) out.push(text)
  }
  return out.slice(-MAX_PROMPT_HISTORY)
}

/** True when the caret is on the first line (or input is empty). */
export function isCaretOnFirstLine(value: string, selectionStart: number): boolean {
  const pos = Math.max(0, Math.min(selectionStart, value.length))
  return !value.slice(0, pos).includes('\n')
}

/** True when the caret is on the last line. */
export function isCaretOnLastLine(value: string, selectionStart: number): boolean {
  const pos = Math.max(0, Math.min(selectionStart, value.length))
  return !value.slice(pos).includes('\n')
}

export interface PromptHistoryStep {
  /** -1 = live draft; 0..n-1 = index into entries (oldest-first). */
  index: number
  value: string
  draft: string
}

/**
 * Shell-style prompt history navigation.
 * `index === -1` means the live draft; Up moves to newest, then older; Down restores draft.
 * Returns null when the key should fall through to normal caret movement.
 */
export function navigatePromptHistory(
  direction: 'up' | 'down',
  index: number,
  draft: string,
  entries: string[],
  currentInput: string
): PromptHistoryStep | null {
  if (entries.length === 0) return null

  if (direction === 'up') {
    if (index === -1) {
      const next = entries.length - 1
      return { index: next, value: entries[next], draft: currentInput }
    }
    if (index <= 0) return null
    return { index: index - 1, value: entries[index - 1], draft }
  }

  // down
  if (index === -1) return null
  if (index >= entries.length - 1) {
    return { index: -1, value: draft, draft }
  }
  return { index: index + 1, value: entries[index + 1], draft }
}

/** Append a sent prompt; drops oldest past the cap. Mutates and returns `entries`. */
export function pushPromptHistory(entries: string[], prompt: string): string[] {
  const text = prompt.trim()
  if (!text) return entries
  entries.push(text)
  if (entries.length > MAX_PROMPT_HISTORY) {
    entries.splice(0, entries.length - MAX_PROMPT_HISTORY)
  }
  return entries
}
