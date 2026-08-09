import { describe, it, expect } from 'vitest'
import { estimateCharsAsTokens, estimateTokens, compactTranscript } from '../transcript'

describe('transcript estimate & compact', () => {
  it('weights CJK denser than latin', () => {
    const latin = estimateCharsAsTokens('a'.repeat(100))
    const cjk = estimateCharsAsTokens('한'.repeat(100))
    expect(cjk).toBeGreaterThan(latin)
  })

  it('counts tool and assistant text', () => {
    const n = estimateTokens([
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi', toolCalls: [{ id: '1', name: 'read_file', arguments: { path: 'a.ts' } }] },
      { role: 'tool', toolCallId: '1', name: 'read_file', content: 'x'.repeat(100) }
    ])
    expect(n).toBeGreaterThan(20)
  })

  it('preserves conclusions in compaction summary', () => {
    const entries = []
    for (let i = 0; i < 40; i++) {
      entries.push({ role: 'user' as const, content: `ask ${i}` })
      entries.push({
        role: 'assistant' as const,
        content: `Conclusion for ${i}: use approach A.`
      })
    }
    const out = compactTranscript(entries, 10)
    expect(out[0].role).toBe('summary')
    expect(String((out[0] as { content: string }).content)).toMatch(/Conclusion|Assistant conclusions/i)
  })
})
