import { describe, it, expect } from 'vitest'
import { PROVIDER_PRESETS } from '../providerPresets'

describe('PROVIDER_PRESETS', () => {
  it('has unique ids and names', () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id)
    const names = PROVIDER_PRESETS.map((p) => p.name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('defines valid providers with non-empty model lists', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(['openai', 'claude']).toContain(preset.apiFormat)
      expect(preset.baseUrl).toMatch(/^https?:\/\//)
      expect(preset.keyHint.length).toBeGreaterThan(0)
      expect(preset.models.length).toBeGreaterThan(0)
    }
  })

  it('assigns a valid tier and label to every model', () => {
    const tiers = new Set(['low', 'mid', 'high'])
    for (const preset of PROVIDER_PRESETS) {
      for (const m of preset.models) {
        expect(tiers.has(m.tier)).toBe(true)
        expect(m.modelId.length).toBeGreaterThan(0)
        expect(m.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps model ids unique within a preset', () => {
    for (const preset of PROVIDER_PRESETS) {
      const ids = preset.models.map((m) => m.modelId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('marks local providers as keyless', () => {
    const local = PROVIDER_PRESETS.filter((p) => p.localNoKey)
    expect(local.length).toBeGreaterThan(0)
    for (const p of local) expect(p.keyHint).toBeTruthy()
  })

  it('includes OpenCode Go, Command Code, and Xiaomi MiMo presets', () => {
    const byId = Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p]))
    expect(byId['opencode-go']?.baseUrl).toBe('https://opencode.ai/zen/go/v1')
    expect(byId['opencode-go']?.apiFormat).toBe('openai')
    expect(byId['opencode-go-anthropic']?.apiFormat).toBe('claude')
    expect(byId['command-code']?.baseUrl).toBe('https://api.commandcode.ai/provider/v1')
    expect(byId['xiaomi-mimo']?.baseUrl).toBe('https://api.xiaomimimo.com/v1')
    expect(byId['xiaomi-mimo-anthropic']?.baseUrl).toBe('https://api.xiaomimimo.com/anthropic')
    expect(byId['xiaomi-mimo']?.models.some((m) => m.modelId === 'mimo-v2.5-pro')).toBe(true)
  })
})
