import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirHolder = vi.hoisted(() => ({ dir: '', project: '' }))

vi.mock('../config', () => ({
  getPawnDir: () => dirHolder.dir
}))

import { matcherMatches, expandToolNames, hookMatchesEvent } from '../hooks/match'
import { getHooksSettings, setHooksSettings } from '../hooks/settings'
import { loadAllHooks, listHooksSummary } from '../hooks/load'
import type { LoadedHook } from '../hooks/types'

beforeAll(() => {
  dirHolder.dir = mkdtempSync(join(tmpdir(), 'pawn-hooks-'))
  dirHolder.project = mkdtempSync(join(tmpdir(), 'pawn-hooks-proj-'))
})

beforeEach(() => {
  rmSync(join(dirHolder.dir, 'hooks-settings.json'), { force: true })
  rmSync(join(dirHolder.dir, 'hooks.json'), { force: true })
  rmSync(join(dirHolder.project, '.pawn'), { recursive: true, force: true })
})

afterAll(() => {
  rmSync(dirHolder.dir, { recursive: true, force: true })
  rmSync(dirHolder.project, { recursive: true, force: true })
})

describe('hooks/match', () => {
  it('matches * and empty', () => {
    expect(matcherMatches('*', 'Bash')).toBe(true)
    expect(matcherMatches('', 'x')).toBe(true)
    expect(matcherMatches(undefined, 'x')).toBe(true)
  })

  it('matches pipe lists', () => {
    expect(matcherMatches('Bash|Write', 'Bash')).toBe(true)
    expect(matcherMatches('Bash|Write', 'Write')).toBe(true)
    expect(matcherMatches('Bash|Write', 'Read')).toBe(false)
  })

  it('expands shell_exec to Bash alias', () => {
    expect(expandToolNames('shell_exec')).toContain('Bash')
    expect(expandToolNames('write_file')).toContain('Write')
  })

  it('matches PreToolUse via alias', () => {
    const hook: LoadedHook = {
      id: 't',
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: { type: 'command', command: 'true' },
      source: 'pawn:user',
      fingerprint: 'x'
    }
    expect(hookMatchesEvent(hook, 'PreToolUse', { toolName: 'shell_exec' })).toBe(true)
    expect(hookMatchesEvent(hook, 'PreToolUse', { toolName: 'read_file' })).toBe(false)
  })
})

describe('hooks/settings', () => {
  it('defaults and patches', () => {
    const s0 = getHooksSettings()
    expect(s0.enabled).toBe(true)
    const s1 = setHooksSettings({ readClaude: false })
    expect(s1.readClaude).toBe(false)
    expect(getHooksSettings().readClaude).toBe(false)
  })
})

describe('hooks/load merge+dedupe', () => {
  it('loads pawn hooks and dedupes identical commands', () => {
    setHooksSettings({ enabled: true, readClaude: false, readPawn: true })
    writeFileSync(
      join(dirHolder.dir, 'hooks.json'),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [{ type: 'command', command: 'echo stop-a' }]
            }
          ]
        }
      })
    )
    mkdirSync(join(dirHolder.project, '.pawn'), { recursive: true })
    writeFileSync(
      join(dirHolder.project, '.pawn', 'hooks.json'),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'echo stop-a' },
                { type: 'command', command: 'echo stop-b' }
              ]
            }
          ]
        }
      })
    )

    const loaded = loadAllHooks(dirHolder.project)
    const stops = loaded.filter((h) => h.event === 'Stop')
    expect(stops).toHaveLength(2)
    expect(stops.map((h) => h.handler.command).sort()).toEqual(['echo stop-a', 'echo stop-b'])

    const summary = listHooksSummary(dirHolder.project)
    expect(summary.hooks.length).toBe(2)
    expect(summary.byEvent.Stop).toBe(2)
  })

  it('returns empty when disabled', () => {
    setHooksSettings({ enabled: false })
    writeFileSync(
      join(dirHolder.dir, 'hooks.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo x' }] }] } })
    )
    expect(loadAllHooks(null)).toEqual([])
  })
})
