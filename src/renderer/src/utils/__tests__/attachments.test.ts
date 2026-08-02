import { describe, it, expect } from 'vitest'
import {
  buildTranscriptText, buildDisplayContent, imageAttachments, stripDisplayImages,
  truncateText, MAX_TEXT_BYTES, type ChatAttachment
} from '../attachments'

const image = (id = 'a1', dataUrl = 'data:image/png;base64,AAAA'): ChatAttachment =>
  ({ id, name: 'shot.png', kind: 'image', dataUrl, bytes: 100 })

const text = (id = 't1', content = 'file body'): ChatAttachment =>
  ({ id, name: 'notes.txt', kind: 'text', content, bytes: content.length })

describe('truncateText', () => {
  it('keeps short text and truncates long text with a note', () => {
    expect(truncateText('hi').text).toBe('hi')
    const out = truncateText('x'.repeat(MAX_TEXT_BYTES + 10))
    expect(out.truncated).toBe(true)
    expect(out.text).toContain('...(truncated)')
  })
})

describe('buildTranscriptText', () => {
  it('appends text attachments as quoted blocks and ignores images', () => {
    const out = buildTranscriptText('look', [text(), image()])
    expect(out).toBe('look\n\n[Attachment: notes.txt]\nfile body')
  })
})

describe('buildDisplayContent', () => {
  it('adds markdown image tags for display on top of the transcript text', () => {
    const out = buildDisplayContent('look', [text(), image('i1', 'data:image/png;base64,BBBB')])
    expect(out).toContain('[Attachment: notes.txt]\nfile body')
    expect(out).toContain('![shot.png](data:image/png;base64,BBBB)')
  })
})

describe('imageAttachments', () => {
  it('returns only images with data', () => {
    expect(imageAttachments([text(), image()])).toEqual([
      { kind: 'image', dataUrl: 'data:image/png;base64,AAAA', name: 'shot.png' }
    ])
    expect(imageAttachments([])).toEqual([])
  })
})

describe('stripDisplayImages', () => {
  it('removes embedded data-URL image tags', () => {
    const content = 'text\n\n![x](data:image/png;base64,AAAA)'
    expect(stripDisplayImages(content)).toBe('text')
  })

  it('leaves normal text and http images alone', () => {
    const content = 'hello ![x](https://example.com/a.png)'
    expect(stripDisplayImages(content)).toBe(content)
  })
})
