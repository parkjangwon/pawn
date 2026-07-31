import { describe, it, expect } from 'vitest'
import { guessPricing } from '../provider'

describe('guessPricing', () => {
  it('matches a known model id exactly', () => {
    const p = guessPricing('gpt-4o')
    expect(p).not.toBeNull()
    expect(p?.tier).toBeDefined()
    expect(p?.input).toBeGreaterThan(0)
  })

  it('matches by longest known-id prefix', () => {
    const p = guessPricing('gpt-4o-mini-2024-07-18')
    expect(p?.tier).toBe('low')
  })

  it('is case-insensitive', () => {
    expect(guessPricing('CLAUDE-SONNET-4-5')).not.toBeNull()
  })

  it('returns null for unknown ids', () => {
    expect(guessPricing('totally-made-up-model')).toBeNull()
  })
})
