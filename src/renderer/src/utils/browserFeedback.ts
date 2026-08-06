/** Browser pick selection, mirroring the shape returned by browser:pickState. */
export interface BrowserPickSelection {
  kind: 'element' | 'text'
  tag?: string
  id?: string
  classes?: string
  selector?: string
  ref?: string | null
  text?: string
  href?: string
  url?: string
  contextTag?: string
  contextText?: string
  box?: { x: number; y: number; w: number; h: number }
}

/**
 * Serialize a picked element/text into a structured block the agent can act
 * on. The attached screenshot (captured while the pick overlay is visible)
 * shows the exact highlighted area.
 */
export function formatBrowserSelectionBlock(sel: BrowserPickSelection, comment: string): string {
  const lines: string[] = []
  lines.push(`<browser_selection url="${(sel.url || '').slice(0, 500)}">`)
  if (sel.kind === 'element') {
    lines.push('kind: element')
    if (sel.tag) lines.push(`tag: ${sel.tag}`)
    if (sel.id) lines.push(`id: ${sel.id}`)
    if (sel.classes) lines.push(`classes: ${sel.classes}`)
    if (sel.selector) lines.push(`selector: ${sel.selector}`)
    if (sel.ref) lines.push(`ref: ${sel.ref}`)
    if (sel.text) lines.push(`text: ${sel.text.slice(0, 500)}`)
    if (sel.href) lines.push(`href: ${sel.href.slice(0, 500)}`)
  } else {
    lines.push('kind: text')
    if (sel.contextTag) lines.push(`context_tag: ${sel.contextTag}`)
    if (sel.contextText) lines.push(`context_text: ${sel.contextText.slice(0, 500)}`)
    if (sel.text) lines.push(`selected_text: ${sel.text.slice(0, 4000)}`)
  }
  lines.push('</browser_selection>')
  const commentText = comment.trim()
  if (commentText) lines.push('', commentText)
  return lines.join('\n')
}

/** Short human-readable label for the selection, shown in the feedback bar. */
export function summarizeBrowserSelection(sel: BrowserPickSelection): string {
  if (sel.kind === 'text') {
    return (sel.text || '').slice(0, 80)
  }
  return sel.selector || sel.text || sel.tag || 'Element'
}
