/** Chat input attachments: images (sent as vision blocks) and text documents
 *  (inlined into the user turn). Displayed as removable chips in the composer. */

export interface ChatAttachment {
  id: string
  name: string
  kind: 'image' | 'text'
  dataUrl?: string
  content?: string
  bytes: number
}

export const MAX_ATTACHMENTS = 10
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const MAX_TEXT_BYTES = 200 * 1024
/** Pasting more text than this becomes an attachment chip instead of filling the input. */
export const LARGE_PASTE_CHARS = 800

export function truncateText(text: string, max = MAX_TEXT_BYTES): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max) + '\n...(truncated)', truncated: true }
}

/** Text that actually goes to the model: message + text attachments as blocks. */
export function buildTranscriptText(text: string, attachments: ChatAttachment[] = []): string {
  let out = text
  for (const a of attachments) {
    if (a.kind === 'text' && a.content) {
      out += `\n\n[Attachment: ${a.name}]\n${a.content}`
    }
  }
  return out
}

/** Bubble text: transcript text + markdown image tags so images render inline. */
export function buildDisplayContent(text: string, attachments: ChatAttachment[] = []): string {
  let out = buildTranscriptText(text, attachments)
  for (const a of attachments) {
    if (a.kind === 'image' && a.dataUrl) out += `\n\n![${a.name}](${a.dataUrl})`
  }
  return out
}

/** Images that must be sent as real vision blocks (not markdown text). */
export function imageAttachments(attachments: ChatAttachment[] = []): Array<{ kind: 'image'; dataUrl: string; name: string }> {
  return attachments
    .filter((a) => a.kind === 'image' && a.dataUrl)
    .map((a) => ({ kind: 'image' as const, dataUrl: a.dataUrl as string, name: a.name }))
}

/** Remove display-only markdown image tags when rebuilding a transcript from history. */
export function stripDisplayImages(content: string): string {
  return content.replace(/!\[[^\]]*\]\(data:image\/[a-zA-Z+.-]+;base64,[^)]+\)/g, '').trim()
}
