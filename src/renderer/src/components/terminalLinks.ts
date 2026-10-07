import type { IBuffer, IBufferLine, ILink } from '@xterm/xterm'

/**
 * ZCode homage (terminalLinks.ts): plain http(s) URLs in the scrollback get
 * underline + pointer cursor and open via pawn's existing `browser:open`
 * channel. Wrapped lines are rejoined before matching so long URLs survive
 * xterm's line wrapping.
 */

const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?]+$/
const CLOSING_BRACKET_PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

interface CellPos {
  cellX: number
  bufferLine: number
}

function countChar(value: string, char: string): number {
  let count = 0
  for (const current of value) {
    if (current === char) count += 1
  }
  return count
}

function trimUrlCandidate(value: string): string {
  let trimmed = value.replace(TRAILING_PUNCTUATION_PATTERN, '')
  for (;;) {
    const last = trimmed.at(-1)
    const opening = last ? CLOSING_BRACKET_PAIRS[last] : undefined
    if (!last || !opening) return trimmed
    if (countChar(trimmed, last) <= countChar(trimmed, opening)) return trimmed
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION_PATTERN, '')
  }
}

interface Snapshot {
  text: string
  positions: CellPos[]
}

function appendLine(snapshot: Snapshot, line: IBufferLine, bufferLine: number, cols: number): void {
  const cell = line.getCell(0)
  for (let x = 0; x < cols; x += 1) {
    const current = line.getCell(x, cell)
    if (!current || current.getWidth() === 0) continue
    const text = current.getChars() || ' '
    snapshot.text += text
    for (let i = 0; i < text.length; i += 1) snapshot.positions.push({ cellX: x, bufferLine })
  }
}

export function getHttpLinksForTerminalBufferLine(
  buffer: IBuffer,
  bufferLineNumber: number,
  cols: number
): Array<Pick<ILink, 'range' | 'text' | 'decorations'>> | undefined {
  let start = bufferLineNumber - 1
  while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1
  let end = bufferLineNumber - 1
  while (end + 1 < buffer.length && buffer.getLine(end + 1)?.isWrapped) end += 1

  const snapshot: Snapshot = { text: '', positions: [] }
  for (let i = start; i <= end; i += 1) {
    const line = buffer.getLine(i)
    if (!line) return undefined
    appendLine(snapshot, line, i + 1, cols)
  }
  if (!snapshot.text) return undefined

  const links: Array<Pick<ILink, 'range' | 'text' | 'decorations'>> = []
  for (const match of snapshot.text.matchAll(HTTP_URL_PATTERN)) {
    const trimmed = trimUrlCandidate(match[0])
    if (!trimmed) continue
    const startIndex = match.index ?? 0
    const first = snapshot.positions[startIndex]
    const last = snapshot.positions[startIndex + trimmed.length - 1]
    if (!first || !last) continue
    const link = {
      text: trimmed,
      range: {
        start: { x: first.cellX + 1, y: first.bufferLine },
        end: { x: last.cellX + 1, y: last.bufferLine }
      },
      decorations: { underline: true, pointerCursor: true }
    }
    if (link.range.start.y <= bufferLineNumber && link.range.end.y >= bufferLineNumber) {
      links.push(link)
    }
  }
  return links.length > 0 ? links : undefined
}

export function isHttpTerminalUrl(text: string): boolean {
  return /^https?:\/\//i.test(text)
}
