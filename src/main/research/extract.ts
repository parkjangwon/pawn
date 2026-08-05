/**
 * Content rescue: HTML → readable text, OGP / JSON-LD extraction.
 * Port of core ideas from insane-search fetch_chain extraction (MIT).
 * No heavy deps — regex + lightweight heuristics.
 */

const SCAN_LIMIT = 2_000_000
const JSONLD_MAX_BLOCKS = 10
const JSONLD_MAX_BLOB = 200_000
const RESCUE_MAX_TEXT = 1_000_000
const JSONLD_MIN_CHARS = 100

export interface ExtractMeta {
  source: string
  title?: string
  description?: string
  error?: string
}

export function qualityScore(md: string): number {
  if (!md) return 0
  const lengthS = Math.min(md.length / 3000, 1)
  const sentences = (md.match(/[.!?。…]\s/g) || []).length + 1
  const words = Math.max(md.split(/\s+/).length, 1)
  const structS = Math.min(sentences / (words / 18 + 1), 1)
  return Math.round(Math.max(0, Math.min(1, 0.6 * lengthS + 0.4 * structS)) * 100) / 100
}

export function stripScriptsStyles(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

export function htmlToVisibleText(html: string): string {
  let s = stripScriptsStyles(html)
  s = s
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Lightweight structure-preserving markdown conversion. */
export function htmlToMarkdown(html: string): string {
  let s = stripScriptsStyles(html)
  // headings
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const text = htmlToVisibleText(inner).replace(/\n+/g, ' ').trim()
    return `\n${'#'.repeat(Number(level))} ${text}\n\n`
  })
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const text = htmlToVisibleText(inner).replace(/\n+/g, ' ').trim() || href
    return `[${text}](${href})`
  })
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const code = htmlToVisibleText(inner)
    return `\n\`\`\`\n${code}\n\`\`\`\n`
  })
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
    return `- ${htmlToVisibleText(inner).replace(/\n+/g, ' ').trim()}\n`
  })
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|section|article|tr|blockquote)>/gi, '\n\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function metaTag(html: string, prop: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i'
  )
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    'i'
  )
  const m = re.exec(html) || re2.exec(html)
  return m?.[1]?.trim()
}

export function extractTitle(html: string): string | undefined {
  const og = metaTag(html, 'og:title')
  if (og) return og
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (m) return htmlToVisibleText(m[1]).trim() || undefined
  return undefined
}

export function extractDescription(html: string): string | undefined {
  return metaTag(html, 'og:description') || metaTag(html, 'description')
}

export function extractJsonLdText(html: string): string {
  const scan = html.slice(0, SCAN_LIMIT)
  const blocks: RegExpExecArray[] = []
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let ldMatch: RegExpExecArray | null
  while ((ldMatch = ldRe.exec(scan)) !== null) {
    blocks.push(ldMatch)
    if (blocks.length >= JSONLD_MAX_BLOCKS) break
  }
  const parts: string[] = []
  for (const m of blocks) {
    const blob = (m[1] || '').trim().slice(0, JSONLD_MAX_BLOB)
    if (!blob) continue
    try {
      const data = JSON.parse(blob)
      const stack = Array.isArray(data) ? data : [data]
      for (const node of stack) {
        walkLd(node, parts)
      }
    } catch {
      // ignore bad JSON-LD
    }
  }
  return parts.join('\n\n').slice(0, RESCUE_MAX_TEXT)
}

function walkLd(node: unknown, parts: string[], depth = 0): void {
  if (!node || depth > 8) return
  if (Array.isArray(node)) {
    for (const n of node) walkLd(n, parts, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  const o = node as Record<string, unknown>
  const body =
    (typeof o.articleBody === 'string' && o.articleBody) ||
    (typeof o.text === 'string' && o.text) ||
    (typeof o.description === 'string' && o.description) ||
    ''
  const headline = typeof o.headline === 'string' ? o.headline : typeof o.name === 'string' ? o.name : ''
  if (body && body.length >= JSONLD_MIN_CHARS) {
    parts.push(headline ? `# ${headline}\n\n${body}` : body)
  } else if (headline && body) {
    parts.push(`${headline}: ${body}`)
  }
  if (o['@graph']) walkLd(o['@graph'], parts, depth + 1)
  if (o.mainEntity) walkLd(o.mainEntity, parts, depth + 1)
}

export function looksLikeHtml(text: string, contentType: string): boolean {
  if (contentType.includes('html')) return true
  const t = text.trimStart().slice(0, 200).toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.includes('<head') || t.includes('<body')
}

export function looksLikeJson(text: string, contentType: string): boolean {
  if (contentType.includes('json')) return true
  const t = text.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

export function extractContent(
  text: string,
  finalUrl: string,
  contentType: string,
  opts: { enableMarkdown?: boolean } = {}
): { content: string; quality: number; meta: ExtractMeta } {
  const enableMarkdown = opts.enableMarkdown !== false
  const ct = (contentType || '').toLowerCase()

  if (looksLikeJson(text, ct) && !looksLikeHtml(text, ct)) {
    try {
      const pretty = JSON.stringify(JSON.parse(text), null, 2)
      return {
        content: pretty.slice(0, RESCUE_MAX_TEXT),
        quality: qualityScore(pretty),
        meta: { source: 'json', title: extractTitle(text) }
      }
    } catch {
      return { content: text.slice(0, RESCUE_MAX_TEXT), quality: 0.3, meta: { source: 'raw' } }
    }
  }

  // RSS / Atom
  if (
    ct.includes('xml') ||
    ct.includes('rss') ||
    ct.includes('atom') ||
    /<(rss|feed)\b/i.test(text.slice(0, 500))
  ) {
    const items = extractFeedItems(text)
    if (items) {
      return {
        content: items.slice(0, RESCUE_MAX_TEXT),
        quality: qualityScore(items),
        meta: { source: 'rss', title: extractTitle(text) || finalUrl }
      }
    }
  }

  if (looksLikeHtml(text, ct) || /<[a-z][\s\S]*>/i.test(text.slice(0, 2000))) {
    const title = extractTitle(text)
    const desc = extractDescription(text)
    const visible = htmlToVisibleText(text)
    const md = enableMarkdown ? htmlToMarkdown(text) : visible
    const jsonLd = extractJsonLdText(text)

    let content = md
    let source = enableMarkdown ? 'html+md' : 'html'
    // SPA shell rescue: JSON-LD article body wins if much thicker
    if (jsonLd.length > Math.max(visible.length * 1.2, JSONLD_MIN_CHARS + 50)) {
      content = [title ? `# ${title}` : null, jsonLd].filter(Boolean).join('\n\n')
      source = 'json_ld'
    } else if (visible.length < 200 && jsonLd.length >= JSONLD_MIN_CHARS) {
      content = [title ? `# ${title}` : null, jsonLd].filter(Boolean).join('\n\n')
      source = 'json_ld'
    } else if (desc && content.length < 100) {
      content = [title ? `# ${title}` : null, desc, content].filter(Boolean).join('\n\n')
    } else if (title && !content.startsWith('#')) {
      content = `# ${title}\n\n${content}`
    }

    return {
      content: content.slice(0, RESCUE_MAX_TEXT),
      quality: qualityScore(content),
      meta: { source, title, description: desc }
    }
  }

  return {
    content: text.slice(0, RESCUE_MAX_TEXT),
    quality: qualityScore(text),
    meta: { source: 'raw' }
  }
}

function extractFeedItems(xml: string): string | null {
  const scan = xml.slice(0, SCAN_LIMIT)
  const items: string[] = []
  const itemRe = /<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi
  let itemMatch: RegExpExecArray | null
  while ((itemMatch = itemRe.exec(scan)) !== null) {
    items.push(itemMatch[0])
    if (items.length >= 40) break
  }
  if (!items.length) return null
  const lines: string[] = ['# Feed']
  for (const block of items) {
    const title = tagText(block, 'title')
    const link = tagText(block, 'link') || attr(block, 'link', 'href')
    const desc = tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content')
    const date = tagText(block, 'pubDate') || tagText(block, 'updated') || tagText(block, 'published')
    lines.push('')
    if (title) lines.push(`## ${decodeXml(title)}`)
    if (link) lines.push(`URL: ${decodeXml(link)}`)
    if (date) lines.push(`Date: ${decodeXml(date)}`)
    if (desc) lines.push(decodeXml(htmlToVisibleText(desc)).slice(0, 800))
  }
  return lines.join('\n')
}

function tagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  if (!m) return undefined
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function attr(xml: string, tag: string, name: string): string | undefined {
  const m = new RegExp(`<${tag}[^>]+${name}=["']([^"']+)["']`, 'i').exec(xml)
  return m?.[1]
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}
