import { describe, expect, it } from 'vitest'
import {
  isModConsented,
  isModConsentStale,
  normalizeConsentList,
  removeConsent,
  upsertConsent
} from '../mods/settings'
import type { ModsSettings } from '../mods/types'

function settings(partial: Partial<ModsSettings>): ModsSettings {
  return {
    enabled: true,
    disableAllHooks: false,
    disabledPlugins: [],
    consentedPlugins: [],
    pluginDirs: [],
    readClaudePlugins: false,
    pluginOrder: [],
    ...partial
  }
}

describe('mod consent version binding', () => {
  it('normalizes legacy string consents to wildcard version', () => {
    expect(normalizeConsentList(['first-mod', { name: 'guard', version: '1.2.0' }])).toEqual([
      { name: 'first-mod', version: '*' },
      { name: 'guard', version: '1.2.0' }
    ])
  })

  it('treats matching version as consented and different version as stale', () => {
    const s = settings({
      consentedPlugins: [{ name: 'first-mod', version: '0.1.0' }]
    })
    expect(isModConsented('first-mod', '0.1.0', s)).toBe(true)
    expect(isModConsentStale('first-mod', '0.1.0', s)).toBe(false)
    expect(isModConsented('first-mod', '0.2.0', s)).toBe(false)
    expect(isModConsentStale('first-mod', '0.2.0', s)).toBe(true)
  })

  it('keeps wildcard consents valid across versions', () => {
    const s = settings({ consentedPlugins: [{ name: 'legacy', version: '*' }] })
    expect(isModConsented('legacy', '9.9.9', s)).toBe(true)
    expect(isModConsentStale('legacy', '9.9.9', s)).toBe(false)
  })

  it('upserts a concrete version and can revoke by name', () => {
    const next = upsertConsent([{ name: 'a', version: '1.0.0' }], 'a', '2.0.0')
    expect(next).toEqual([{ name: 'a', version: '2.0.0' }])
    expect(removeConsent(next, 'a')).toEqual([])
  })
})
