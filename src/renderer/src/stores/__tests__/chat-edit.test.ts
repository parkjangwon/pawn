// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (k: string) => k })
}))

import {
  truncateBeforeUserIndex,
  truncateAfterUserIndex,
  displayUserIndex,
  sealTranscriptTail
} from '../../agent/transcriptTruncate'
import type { TranscriptEntry } from '../../agent/transcript'

const u = (c: string, attachments?: TranscriptEntry extends { role: 'user' } ? never : never): TranscriptEntry =>
  ({ role: 'user', content: c } as TranscriptEntry)

describe('edit/regenerate transcript helpers (integration contract)', () => {
  it('edit keeps prior tool pairs and drops the edited user onward', () => {
    const entries: TranscriptEntry[] = [
      { role: 'user', content: 'u0' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't', name: 'read_file', arguments: { path: 'a' } }]
      },
      { role: 'tool', toolCallId: 't', name: 'read_file', content: 'BODY' },
      { role: 'user', content: 'u1 to edit' },
      { role: 'assistant', content: 'reply' }
    ]
    const uIdx = 1
    const kept = sealTranscriptTail(truncateBeforeUserIndex(entries, uIdx))
    expect(kept.map((e) => e.role)).toEqual(['user', 'assistant', 'tool'])
    expect((kept[2] as { content: string }).content).toBe('BODY')
  })

  it('regenerate keeps the user turn attachments source', () => {
    const entries: TranscriptEntry[] = [
      {
        role: 'user',
        content: 'see image',
        attachments: [{ kind: 'image', dataUrl: 'data:image/png;base64,xx', name: 'x.png' }]
      },
      { role: 'assistant', content: 'I see it' }
    ]
    const kept = truncateAfterUserIndex(entries, 0)
    const last = kept[kept.length - 1]
    expect(last.role).toBe('user')
    if (last.role === 'user') {
      expect(last.attachments?.[0].dataUrl).toContain('data:image')
    }
  })

  it('displayUserIndex matches UI ordering', () => {
    const msgs = [
      { id: 's', role: 'system' },
      { id: 'u0', role: 'user' },
      { id: 'a0', role: 'assistant' },
      { id: 'u1', role: 'user' }
    ]
    expect(displayUserIndex(msgs, 'u1')).toBe(1)
  })
})
