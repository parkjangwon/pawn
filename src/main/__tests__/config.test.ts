import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadConfig, saveConfig } from '../config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pawn-config-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    expect(loadConfig(dir)).toEqual({ settings: {}, providers: [], models: [] })
  })

  it('parses a valid TOML config', () => {
    writeFileSync(join(dir, 'config.toml'), '[settings]\ntheme = "dark"\nlanguage = "ko"\n', 'utf-8')
    const cfg = loadConfig(dir)
    expect(cfg.settings?.theme).toBe('dark')
    expect(cfg.settings?.language).toBe('ko')
  })

  it('falls back to defaults on corrupt TOML', () => {
    writeFileSync(join(dir, 'config.toml'), 'not [valid toml', 'utf-8')
    expect(loadConfig(dir)).toEqual({ settings: {}, providers: [], models: [] })
  })
})

describe('saveConfig', () => {
  it('writes a config file and round-trips values', () => {
    saveConfig(
      {
        settings: { theme: 'light' },
        providers: [{ id: 'p1', name: 'P', apiFormat: 'openai', authMethod: 'api-key', baseUrl: 'https://x', enabled: true }],
        models: []
      },
      dir
    )
    expect(existsSync(join(dir, 'config.toml'))).toBe(true)
    const cfg = loadConfig(dir)
    expect(cfg.settings?.theme).toBe('light')
    expect(cfg.providers).toHaveLength(1)
  })

  it('deep-merges settings while replacing arrays wholesale', () => {
    saveConfig({ settings: { theme: 'dark', routingMode: 'auto' } }, dir)
    saveConfig({ settings: { language: 'en' } }, dir)
    const cfg = loadConfig(dir)
    expect(cfg.settings).toEqual({ theme: 'dark', routingMode: 'auto', language: 'en' })

    saveConfig({ providers: [{ id: 'p2', name: 'P2', apiFormat: 'claude', authMethod: 'api-key', baseUrl: 'https://y', enabled: false }] }, dir)
    const after = loadConfig(dir)
    expect(after.providers).toHaveLength(1)
    expect(after.providers?.[0].id).toBe('p2')
    expect(after.settings?.theme).toBe('dark')
  })

  it('persists api keys verbatim', () => {
    saveConfig(
      { providers: [{ id: 'p', name: 'P', apiFormat: 'openai', authMethod: 'api-key', baseUrl: 'https://x', apiKey: 'sk-abc-123', enabled: true }] },
      dir
    )
    const raw = readFileSync(join(dir, 'config.toml'), 'utf-8')
    expect(raw).toContain('sk-abc-123')
    expect(loadConfig(dir).providers?.[0].apiKey).toBe('sk-abc-123')
  })
})
