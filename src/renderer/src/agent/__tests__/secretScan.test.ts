import { describe, it, expect } from 'vitest'
import { scanForSecrets, formatSecretScanBlock } from '../secretScan'
import { validateCommitMessage } from '../gitWrite'

describe('secretScan', () => {
  it('detects common API key shapes', () => {
    expect(scanForSecrets('key sk-abcdefghijklmnopqrstuvwxyz1234')).toContain('OpenAI key')
    expect(scanForSecrets('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toContain('GitHub PAT')
    expect(scanForSecrets('-----BEGIN RSA PRIVATE KEY-----')).toContain('Private key block')
  })

  it('returns empty for clean text', () => {
    expect(scanForSecrets('feat: improve git panel staging')).toEqual([])
  })

  it('blocks commit messages that embed secrets', () => {
    const err = validateCommitMessage('deploy sk-abcdefghijklmnopqrstuvwxyz1234')
    expect(err).toBeTruthy()
    expect(err).toMatch(/secret/i)
  })

  it('formats a readable block', () => {
    expect(formatSecretScanBlock(['OpenAI key'])).toContain('OpenAI key')
  })
})
