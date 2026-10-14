import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let dir = ''
vi.mock('../config', () => ({ getPawnDir: () => dir }))

import { migrateSampleModDefault } from '../mods/settings'

const file = (): string => join(dir, 'mods-settings.json')
const read = (): Record<string, unknown> => JSON.parse(readFileSync(file(), 'utf-8'))
const seed = (o: unknown): void => writeFileSync(file(), JSON.stringify(o))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mods-mig-'))
})

describe('migrateSampleModDefault', () => {
  it('fresh install disables first-mod', () => {
    migrateSampleModDefault()
    expect(read()).toEqual({ disabledPlugins: ['first-mod'], consentedPlugins: [], sampleModMigrated: true })
  })

  it('legacy file stays legacy', () => {
    seed({ enabled: true })
    migrateSampleModDefault()
    const s = read()
    expect(s.disabledPlugins).toEqual(['first-mod'])
    expect(s.sampleModMigrated).toBe(true)
    expect('consentedPlugins' in s).toBe(false)
  })

  it("'*' consent is implicit, so disabled once", () => {
    seed({ consentedPlugins: [{ name: 'First-Mod', version: '*' }], disabledPlugins: ['first-mod'] })
    migrateSampleModDefault()
    expect(read().disabledPlugins).toEqual(['first-mod'])
    seed({ consentedPlugins: ['first-mod'] })
    migrateSampleModDefault()
    expect(read().disabledPlugins).toEqual(['first-mod'])
  })

  it('concrete consent and not disabled stays enabled', () => {
    seed({ consentedPlugins: [{ name: 'first-mod', version: '0.1.0' }] })
    migrateSampleModDefault()
    expect(read().disabledPlugins).toEqual([])
    expect(read().sampleModMigrated).toBe(true)
  })

  it('second run is a no-op after the user re-enables', () => {
    migrateSampleModDefault()
    seed({ disabledPlugins: [], consentedPlugins: [], sampleModMigrated: true })
    migrateSampleModDefault()
    expect(read().disabledPlugins).toEqual([])
  })

  it('swallows I/O errors', () => {
    dir = join(dir, 'file-not-dir')
    writeFileSync(dir, 'x')
    expect(() => migrateSampleModDefault()).not.toThrow()
    expect(existsSync(dir)).toBe(true)
  })
})
