import { describe, it, expect } from 'vitest'
import { validateCommitMessage } from '../gitWrite'

describe('validateCommitMessage', () => {
  it('accepts normal messages', () => {
    expect(validateCommitMessage('feat: add spawn_agent tool')).toBeNull()
    expect(validateCommitMessage('Fix race in tool loop\n\nDetails here.')).toBeNull()
  })

  it('rejects placeholders and empty', () => {
    expect(validateCommitMessage('wip')).toBeTruthy()
    expect(validateCommitMessage('fix')).toBeTruthy()
    expect(validateCommitMessage('ab')).toBeTruthy()
  })
})
