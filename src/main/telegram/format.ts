/** Telegram message length. Leave a little room under the 4096 hard cap. */
export const TELEGRAM_TEXT_LIMIT = 4096
const CHUNK_LIMIT = 3900

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineMarkdown(src: string): string {
  let t = escapeTelegramHtml(src)
  t = t.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`)
  t = t.replace(/\*\*([^*\n]+)\*\*/g, (_m, bold: string) => `<b>${bold}</b>`)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, href: string) => {
    const safe = href.replace(/"/g, '%22').replace(/&/g, '%26')
    return `<a href="${safe}">${label}</a>`
  })
  return t
}

/**
 * A small Markdown subset as Telegram HTML: fenced code, inline code, bold,
 * and http(s) links. Anything else stays escaped text.
 */
export function markdownToTelegramHtml(src: string): string {
  const parts = src.split('```')
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      out += inlineMarkdown(parts[i])
      continue
    }
    const body = parts[i]
    const nl = body.indexOf('\n')
    const code = nl === -1 ? body : body.slice(nl + 1).replace(/\n$/, '')
    out += `<pre>${escapeTelegramHtml(code)}</pre>`
  }
  return out
}

/** Split on paragraph, then line, then a hard cut. Pieces stay within `limit`. */
export function chunkText(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text.length ? [text] : []].flat()
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit)
    if (cut < Math.floor(limit * 0.4)) cut = rest.lastIndexOf('\n', limit)
    if (cut < Math.floor(limit * 0.4)) cut = limit
    const piece = rest.slice(0, cut).replace(/\s+$/, '')
    if (piece) chunks.push(piece)
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks.length ? chunks : [text.slice(0, limit)]
}
