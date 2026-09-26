import type { Message } from '../stores/app'
import { stripDisplayImages } from './attachments'

/** Context blocks that @mentions / skills / git specials prepend to a prompt. */
const INJECTED_BLOCK_RE =
  /<(file|folder|git|git_diff|skill|auto_verify|issue_to_pr_playbook)\b[^>]*>[\s\S]*?<\/\1>/g

/** Plain-text preview of a user prompt: injected context blocks removed. */
export function userPreviewText(content: string, max = 160): string {
  const text = stripDisplayImages(content || '')
    .replace(INJECTED_BLOCK_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return truncate(text, max)
}

/** Rough markdown → one-paragraph plain text for hover previews. */
export function markdownPreviewText(content: string, max = 220): string {
  const text = (content || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ⋯ ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return truncate(text, max)
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

export interface TurnItem {
  /** Id of the user message that starts the turn. */
  id: string
  /** Index of that message in the session's message array. */
  index: number
  userPreview: string
  /** First assistant text reply in the turn, if any. */
  replyPreview: string | null
}

/** One entry per user prompt, paired with the first assistant reply after it. */
export function buildTurnItems(messages: Message[]): TurnItem[] {
  const items: TurnItem[] = []
  let current: TurnItem | null = null
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user') {
      current = { id: m.id, index: i, userPreview: userPreviewText(m.content), replyPreview: null }
      items.push(current)
    } else if (m.role === 'assistant' && current && current.replyPreview === null) {
      const preview = markdownPreviewText(m.content)
      if (preview) current.replyPreview = preview
    }
  }
  return items
}

/**
 * Rail "magnification" around the hovered bar: the focused bar widens most,
 * neighbours taper off — reads like a dock and makes the target obvious.
 */
export function turnBarVisual(index: number, focusIndex: number | null): { scale: number; opacity: number } {
  if (focusIndex === null) return { scale: 1, opacity: 0.55 }
  const d = Math.abs(index - focusIndex)
  if (d === 0) return { scale: 2.6, opacity: 1 }
  if (d === 1) return { scale: 1.7, opacity: 0.85 }
  if (d === 2) return { scale: 1.25, opacity: 0.7 }
  return { scale: 1, opacity: 0.55 }
}

/** Markdown blockquote of a selection, ready to drop into the composer. */
export function formatQuote(text: string, max = 6000): string {
  let body = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim()
  if (!body) return ''
  if (body.length > max) body = body.slice(0, max).trimEnd() + '…'
  return body
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
}

/** Append a quote to the current draft with blank-line separation. */
export function appendQuoteToDraft(draft: string, quote: string): string {
  if (!quote) return draft
  const head = draft.replace(/\s+$/, '')
  return (head ? `${head}\n\n` : '') + quote + '\n\n'
}
