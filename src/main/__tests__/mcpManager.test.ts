import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { discoverConfigs, writeServerConfig, removeServerConfig } from '../mcpManager'

let pawnDir: string
let projectDir: string
let fakeHome: string

vi.mock('../config', () => ({
  getPawnDir: () => pawnDir
}))

// discoverConfigs always reads `~/.claude.json` as one of its sources — point
// homedir() at an empty temp dir so these tests aren't polluted by (or
// dependent on) whatever real MCP servers happen to be configured on the
// machine running them. vi.mock calls are hoisted above these imports, so
// mcpManager's `getPawnDir`/`homedir` bindings resolve to the mocks below.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => fakeHome }
})

beforeEach(() => {
  pawnDir = mkdtempSync(join(tmpdir(), 'pawn-mcp-user-test-'))
  projectDir = mkdtempSync(join(tmpdir(), 'pawn-mcp-project-test-'))
  fakeHome = mkdtempSync(join(tmpdir(), 'pawn-mcp-home-test-'))
})

afterEach(() => {
  rmSync(pawnDir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('discoverConfigs', () => {
  it('returns nothing when no config files exist', async () => {
    expect(await discoverConfigs(projectDir)).toEqual([])
  })

  it('skips non-stdio (http/sse) entries — remote connectors are out of scope', async () => {
    mkdirSync(projectDir, { recursive: true })
    await writeServerConfig('project', projectDir, 'local', { command: 'npx', args: ['pkg'] })
    // Hand-write a second, non-stdio entry alongside the one writeServerConfig made.
    const fs = await import('fs/promises')
    const path = join(projectDir, '.mcp.json')
    const file = JSON.parse(await fs.readFile(path, 'utf-8'))
    file.mcpServers.remote = { type: 'http', url: 'https://example.com/mcp' }
    await fs.writeFile(path, JSON.stringify(file, null, 2))

    const configs = await discoverConfigs(projectDir)
    expect(configs.map((c) => c.id)).toEqual(['local'])
  })
})

describe('writeServerConfig', () => {
  it('adds a project-scoped server that discoverConfigs then reports with source "project"', async () => {
    const res = await writeServerConfig('project', projectDir, 'my-tool', { command: 'npx', args: ['-y', 'my-tool-mcp'] })
    expect(res.ok).toBe(true)
    const configs = await discoverConfigs(projectDir)
    expect(configs).toEqual([
      { id: 'my-tool', command: 'npx', args: ['-y', 'my-tool-mcp'], env: undefined, cwd: projectDir, source: 'project' }
    ])
  })

  it('adds a user-scoped server visible across every project', async () => {
    const res = await writeServerConfig('user', undefined, 'global-tool', { command: 'global-tool', args: [] })
    expect(res.ok).toBe(true)
    const configs = await discoverConfigs(projectDir)
    expect(configs).toEqual([{ id: 'global-tool', command: 'global-tool', args: [], env: undefined, cwd: undefined, source: 'user-pawn' }])
    // And it's visible even with no project open at all.
    expect(await discoverConfigs(undefined)).toEqual(configs)
  })

  it('lets a project-scoped server override a same-id user-scoped one', async () => {
    await writeServerConfig('user', undefined, 'shared', { command: 'user-version', args: [] })
    await writeServerConfig('project', projectDir, 'shared', { command: 'project-version', args: [] })
    const configs = await discoverConfigs(projectDir)
    expect(configs).toHaveLength(1)
    expect(configs[0].command).toBe('project-version')
    expect(configs[0].source).toBe('project')
  })

  it('sanitizes ids containing __ so mcp__<id>__<tool> parsing on the renderer side stays unambiguous', async () => {
    await writeServerConfig('user', undefined, 'weird__id', { command: 'x', args: [] })
    const configs = await discoverConfigs(undefined)
    expect(configs[0].id).toBe('weird_id')
  })

  it('rejects an empty id or command', async () => {
    expect((await writeServerConfig('user', undefined, '', { command: 'x', args: [] })).ok).toBe(false)
    expect((await writeServerConfig('user', undefined, 'ok', { command: '', args: [] })).ok).toBe(false)
  })

  it('rejects a project scope with no active project', async () => {
    const res = await writeServerConfig('project', undefined, 'x', { command: 'y', args: [] })
    expect(res.ok).toBe(false)
  })

  it('preserves any pre-existing content in the target file (only mcpServers is touched)', async () => {
    const fs = await import('fs/promises')
    mkdirSync(projectDir, { recursive: true })
    await fs.writeFile(join(projectDir, '.mcp.json'), JSON.stringify({ $schema: 'https://example.com/schema.json', mcpServers: {} }))
    await writeServerConfig('project', projectDir, 'tool', { command: 'x', args: [] })
    const file = JSON.parse(await fs.readFile(join(projectDir, '.mcp.json'), 'utf-8'))
    expect(file.$schema).toBe('https://example.com/schema.json')
    expect(file.mcpServers.tool.command).toBe('x')
  })
})

describe('removeServerConfig', () => {
  it('removes a previously-added server', async () => {
    await writeServerConfig('project', projectDir, 'tool', { command: 'x', args: [] })
    expect(await discoverConfigs(projectDir)).toHaveLength(1)
    const res = await removeServerConfig('project', projectDir, 'tool')
    expect(res.ok).toBe(true)
    expect(await discoverConfigs(projectDir)).toEqual([])
  })

  it('is a no-op (still ok) when the id was never present', async () => {
    const res = await removeServerConfig('project', projectDir, 'nope')
    expect(res.ok).toBe(true)
  })
})
