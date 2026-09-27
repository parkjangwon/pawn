// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { detectLanguage } from '../index'

describe('first-launch language', () => {
  it('follows the first supported OS language, else English', () => {
    expect(detectLanguage(['ko-KR', 'en-US'])).toBe('ko')
    expect(detectLanguage(['fr-FR', 'ja-JP'])).toBe('ja')
    expect(detectLanguage(['zh-Hans-CN'])).toBe('zh')
    expect(detectLanguage(['de-DE'])).toBe('en')
    expect(detectLanguage([])).toBe('en')
    expect(detectLanguage(undefined)).toBe('en')
  })
})
