// @vitest-environment jsdom
/**
 * Wiring: PostToolUse / PostToolUseFailure fire from the real tool executor
 * only after a tool actually ran, and a failing mod never changes the result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolCall } from '../tools'
import { getModRuntime, __resetModRuntimeForTests } from '../mods/runtime'
import { __resetModsClientForTests } from '../mods/client'
import { useProviderStore } from '../../stores/provider'
import { usePermissionStore } from '../../stores/permission'
import { __resetFileSnapshotsForTests } from '../fileSnapshots'

const D = (src: string): string => src.replace(/__API__/g, '$')
async function loadMod(name: string, lines: string[]): Promise<void> {
  await getModRuntime().load([{ id: `${name}@test`, name, root: `/tmp/${name}`, tier: 'user', sources: [D(lines.join('\n'))] }])
}
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
type Seen = Array<[string, Record<string, unknown>]>
const g = globalThis as { __seenW?: Seen }
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: 'c1', name, arguments: args })
const fsMock = {
  readFile: vi.fn(), readFiles: vi.fn(), writeFile: vi.fn(), listDir: vi.fn(), walk: vi.fn(), exists: vi.fn(), contentSearch: vi.fn()
}
const recorder = (ev: string): string => `  on('${ev}', async (__API__, e, next) => { globalThis.__seenW.push(['${ev}', JSON.parse(JSON.stringify(e))]); return next(e) })`

beforeEach(() => {
  __resetFileSnapshotsForTests()
  __resetModRuntimeForTests()
  __resetModsClientForTests()
  g.__seenW = []
  ;(window as any).api = { fs: fsMock }
  for (const fn of Object.values(fsMock)) fn.mockReset()
  fsMock.readFiles.mockImplementation((paths: string[]) =>
    Promise.all(paths.map(async (p: string) => {
      const r = await fsMock.readFile(p)
      return typeof r === 'string' ? { path: p, content: r } : { path: p, error: String(r?.error || 'read failed') }
    }))
  )
  fsMock.listDir.mockResolvedValue([])
  useProviderStore.setState({ permissionMode: 'yolo' })
  usePermissionStore.setState({ pending: [] })
})
afterEach(() => {
  __resetModRuntimeForTests()
  vi.restoreAllMocks()
})

describe('tool executor emits tool.result / tool.error', () => {
  it('PostToolUse after a successful tool, with its input and output', async () => {
    await loadMod('w', ['export function register(on) {', recorder('PostToolUse'), recorder('PostToolUseFailure'), '}'])
    fsMock.readFile.mockResolvedValue('file body')
    const result = await executeTool(call('read_file', { path: '/a.ts' }))
    await flush()
    expect(result.isError).toBeFalsy()
    const seen = g.__seenW!
    expect(seen.map((s) => s[0])).toEqual(['PostToolUse'])
    expect(seen[0][1]).toMatchObject({ tool: 'read_file', tool_name: 'read_file', tool_use_id: 'c1', tool_input: { path: '/a.ts' } })
    expect(String((seen[0][1].tool_response as { content: string }).content)).toContain('file body')
  })

  it('PostToolUseFailure when the tool returns an error', async () => {
    await loadMod('w', ['export function register(on) {', recorder('PostToolUse'), recorder('PostToolUseFailure'), '}'])
    fsMock.readFile.mockResolvedValue({ error: 'ENOENT' })
    const result = await executeTool(call('read_file', { path: '/missing.ts' }))
    await flush()
    expect(result.isError).toBe(true)
    expect(g.__seenW!.map((s) => s[0])).toEqual(['PostToolUseFailure'])
    expect(g.__seenW![0][1]).toMatchObject({ tool: 'read_file', tool_use_id: 'c1' })
    expect(String(g.__seenW![0][1].error)).toContain('ENOENT')
  })

  it('does not fire when a mod denies the call (the tool never ran)', async () => {
    await loadMod('w', [
      'export function register(on) {',
      "  on('tool.call', { tool: 'read_file' }, async () => ({ deny: 'no' }))",
      recorder('PostToolUse'), recorder('PostToolUseFailure'),
      '}'
    ])
    const result = await executeTool(call('read_file', { path: '/a.ts' }))
    await flush()
    expect(result.content).toMatch(/Blocked by extension/)
    expect(fsMock.readFile).not.toHaveBeenCalled()
    expect(g.__seenW).toEqual([])
  })

  it('a throwing or hanging PostToolUse mod does not change or delay the result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadMod('bad', [
      'export function register(on) {',
      "  on('PostToolUse', async () => { throw new Error('boom') })",
      "  on('tool.result', () => new Promise(() => {}))",
      '}'
    ])
    fsMock.readFile.mockResolvedValue('file body')
    const t0 = Date.now()
    const result = await executeTool(call('read_file', { path: '/a.ts' }))
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('file body')
  })
})
