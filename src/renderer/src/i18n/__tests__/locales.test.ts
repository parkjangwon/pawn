import { describe, it, expect } from 'vitest'
import en from '../locales/en.json'
import ko from '../locales/ko.json'
import ja from '../locales/ja.json'
import zh from '../locales/zh.json'

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

const locales: Record<string, Record<string, unknown>> = { en, ko, ja, zh }

describe('i18n locales', () => {
  it('keeps identical translation key sets across all languages', () => {
    const base = new Set(collectKeys(en))
    expect(base.size).toBeGreaterThan(50)
    for (const [name, locale] of Object.entries(locales)) {
      const keys = new Set(collectKeys(locale))
      expect([...keys].sort(), name).toEqual([...base].sort())
    }
  })

  it('has no empty or whitespace-only values', () => {
    const walk = (obj: Record<string, unknown>, path = ''): void => {
      for (const [key, value] of Object.entries(obj)) {
        const p = path ? `${path}.${key}` : key
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          walk(value as Record<string, unknown>, p)
        } else {
          expect(typeof value, `${p}`).toBe('string')
          expect((value as string).trim().length, `${p}`).toBeGreaterThan(0)
        }
      }
    }
    for (const [name, locale] of Object.entries(locales)) {
      walk(locale, name)
    }
  })

  it('translates a few core strings in every language', () => {
    for (const [name, locale] of Object.entries(locales)) {
      const bar = locale.contextBar as Record<string, unknown> | undefined
      const panel = locale.rightPanel as { tools?: Record<string, unknown> } | undefined
      expect(bar?.switchProject, `${name}.contextBar.switchProject`).toBeTruthy()
      expect(panel?.tools?.terminal, `${name}.rightPanel.tools.terminal`).toBeTruthy()
      expect(locale.sidebar, `${name}.sidebar`).toBeTruthy()
    }
  })
})
