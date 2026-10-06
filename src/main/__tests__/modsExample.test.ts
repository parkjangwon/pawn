import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { HOOKS_JSON, PLUGIN_JSON, REGISTER_JS } from '../mods/example'

const EXAMPLE_DIR = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'examples/mods/first-mod'
)

describe('install sample mod', () => {
  it('writes the same files as examples/mods/first-mod', () => {
    expect(PLUGIN_JSON.trim()).toBe(
      readFileSync(join(EXAMPLE_DIR, '.claude-plugin', 'plugin.json'), 'utf-8').trim()
    )
    expect(HOOKS_JSON.trim()).toBe(
      readFileSync(join(EXAMPLE_DIR, 'hooks', 'hooks.json'), 'utf-8').trim()
    )
    expect(REGISTER_JS).toBe(readFileSync(join(EXAMPLE_DIR, 'hooks', 'register.js'), 'utf-8'))
  })
})
