import { describe, it, expect } from 'vitest'
import type { TranscriptEntry } from '../transcript'
import {
  truncateBeforeUserIndex,
  truncateAfterUserIndex,
  displayUserIndex,
  sealTranscriptTail
} from '../transcriptTruncate'

const u = (c: string): TranscriptEntry => ({ role: 'user', content: c })
const a = (c: string, tools?: boolean): TranscriptEntry =>
  tools
    ? {
        role: 'assistant',
        content: c,
        toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: 'a.ts' } }]
      }
    : { role: 'assistant', content: c }
const t = (c: string): TranscriptEntry => ({
  role: 'tool',
  toolCallId: 't1',
  name: 'read_file',
  content: c
})

describe('transcriptTruncate', () => {
  const sample: TranscriptEntry[] = [
    u('first'),
    a('ok1', true),
    t('file body'),
    u('second'),
    a('ok2'),
    u('third')
  ]

  it('truncates before user index keeping tool pairs', () => {
    const kept = truncateBeforeUserIndex(sample, 1)
    expect(kept.map((e) => e.role)).toEqual(['user', 'assistant', 'tool'])
    expect((kept[0] as { content: string }).content).toBe('first')
  })

  it('truncates after user index for regenerate', () => {
    const kept = truncateAfterUserIndex(sample, 1)
    expect(kept.map((e) => e.role)).toEqual(['user', 'assistant', 'tool', 'user'])
    expect((kept[kept.length - 1] as { content: string }).content).toBe('second')
  })

  it('maps display user index', () => {
    const msgs = [
      { id: 'a', role: 'assistant' },
      { id: 'u1', role: 'user' },
      { id: 'a2', role: 'assistant' },
      { id: 'u2', role: 'user' }
    ]
    expect(displayUserIndex(msgs, 'u1')).toBe(0)
    expect(displayUserIndex(msgs, 'u2')).toBe(1)
  })

  it('seals incomplete tool tails', () => {
    const broken: TranscriptEntry[] = [u('q'), a('x', true), t('r'), a('y', true)]
    const sealed = sealTranscriptTail(broken)
    expect(sealed[sealed.length - 1].role).not.toBe('assistant')
  })
})
