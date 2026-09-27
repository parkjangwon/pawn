// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { __resetFileSnapshotsForTests } from '../fileSnapshots'
import { executeTool } from '../toolExecutor'
import {
  APPLY_PATCH_NAME,
  callPaths,
  isFileMutation,
  planApplyPatch,
  planClaudeNativeTools,
  prefersApplyPatch
} from '../nativeTools'
import { effectiveToolName } from '../toolIdentity'
import { claudeToolsWithNative, openAIToolsWithPatch } from '../llm'
import { toolsToClaude, toolsToOpenAI } from '../toolWire'
import { checkSubagentToolCall } from '../subagentToolPolicy'
import { applyTextEdits } from '../fileTransaction'
import { useProviderStore } from '../../stores/provider'
import { useChangeLedger } from '../../stores/changeLedger'

/** In-memory project files. */
let files: Map<string, string>
let failWrites: Set<string>
const ROOT = '/proj'

function installFs(): void {
  ;(window as any).api = {
    platform: 'darwin',
    fs: {
      readFile: vi.fn(async (p: string) => (files.has(p) ? files.get(p) : { error: `ENOENT: ${p}` })),
      writeFile: vi.fn(async (p: string, c: string) => {
        if (failWrites.has(p)) return { error: 'EACCES: permission denied' }
        files.set(p, c)
        return { ok: true }
      }),
      delete: vi.fn(async (p: string) => {
        files.delete(p)
        return { ok: true }
      }),
      exists: vi.fn(async (p: string) => files.has(p)),
      stat: vi.fn(async (p: string) => {
        if (files.has(p)) return { size: files.get(p)!.length, isFile: true, isDirectory: false, mtime: 0 }
        if (Array.from(files.keys()).some((k) => k.startsWith(`${p}/`))) return { size: 0, isFile: false, isDirectory: true, mtime: 0 }
        return { error: 'ENOENT' }
      }),
      listDir: vi.fn(async (d: string) => {
        const names = new Map<string, boolean>()
        for (const k of Array.from(files.keys())) {
          if (!k.startsWith(`${d}/`)) continue
          const rest = k.slice(d.length + 1)
          const [head, ...more] = rest.split('/')
          names.set(head, more.length > 0 || names.get(head) === true)
        }
        return Array.from(names.entries()).map(([name, isDirectory]) => ({ name, isDirectory, path: `${d}/${name}` }))
      })
    },
    shell: { exec: vi.fn(), execFile: vi.fn() }
  }
}

beforeEach(() => {
  __resetFileSnapshotsForTests()
  files = new Map([
    [`${ROOT}/src/app.ts`, 'export function add(a: number, b: number) {\n  return a + b\n}\n'],
    [`${ROOT}/src/util.ts`, 'export const ONE = 1\nexport const TWO = 2\n'],
    [`${ROOT}/README.md`, '# demo\n']
  ])
  failWrites = new Set()
  installFs()
  useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {}, lspDiagnostics: false, nativeCodingTools: true, nativeComputerTool: true } as any)
  useChangeLedger.setState({ turns: [], activeTurnId: null } as any)
  useChangeLedger.getState().beginTurn('s1', 'p1', 'test')
})

const call = (name: string, args: Record<string, unknown>, id = 'c1') => ({ id, name, arguments: args })
const ctx = { sessionId: 's1', projectId: 'p1' }

describe('native tool planning', () => {
  const claudeBase = { apiFormat: 'claude', baseUrl: 'https://api.anthropic.com/v1', toolNames: ['read_file', 'write_file', 'edit_file', 'shell_exec'], platform: 'darwin' }

  it('declares text_editor_20250728 + bash_20250124 for Claude 4+ on the Anthropic API', () => {
    const plan = planClaudeNativeTools({ ...claudeBase, modelId: 'claude-opus-5-5' })
    expect(plan?.entries).toEqual([
      { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
      { type: 'bash_20250124', name: 'bash' }
    ])
    expect(Array.from(plan!.drop).sort()).toEqual(['edit_file', 'read_file', 'write_file'])
    expect(plan!.note).toContain('str_replace_based_edit_tool')
    expect(planClaudeNativeTools({ ...claudeBase, modelId: 'claude-sonnet-4-20250514' })?.entries).toHaveLength(2)
  })

  it('stays off where it does not apply', () => {
    expect(planClaudeNativeTools({ ...claudeBase, modelId: 'claude-opus-5-5', baseUrl: 'https://openrouter.ai/api/v1' })).toBeNull()
    expect(planClaudeNativeTools({ ...claudeBase, modelId: 'claude-3-5-sonnet' })).toBeNull()
    expect(planClaudeNativeTools({ ...claudeBase, modelId: 'claude-opus-5-5', enabled: false })).toBeNull()
    // Plan mode: no edit / shell tools in the request → nothing to replace.
    expect(planClaudeNativeTools({ ...claudeBase, modelId: 'claude-opus-5-5', toolNames: ['read_file'] })).toBeNull()
    // Windows keeps shell_exec (no POSIX session), editor still applies.
    expect(planClaudeNativeTools({ ...claudeBase, modelId: 'claude-opus-5-5', platform: 'win32' })?.entries.map((e) => e.type)).toEqual(['text_editor_20250728'])
  })

  it('gives GPT-family models apply_patch in place of edit_file/write_file', () => {
    for (const id of ['gpt-5.4', 'gpt-4.1-mini', 'o3', 'o4-mini', 'openai/gpt-5.1-codex', 'gpt-5-codex']) expect(prefersApplyPatch(id), id).toBe(true)
    for (const id of ['gpt-4o', 'deepseek-v4', 'claude-opus-5-5', 'qwen3-coder']) expect(prefersApplyPatch(id), id).toBe(false)
    expect(planApplyPatch('gpt-5.4', ['edit_file', 'write_file'])?.add.name).toBe(APPLY_PATCH_NAME)
    expect(planApplyPatch('gpt-5.4', ['read_file'])).toBeNull()
    expect(planApplyPatch('gpt-5.4', ['edit_file', 'write_file'], false)).toBeNull()
  })

  it('swaps the request tools with one cache breakpoint (Claude) and apply_patch (OpenAI)', async () => {
    const claude = await claudeToolsWithNative(toolsToClaude([], { mode: 'build' }), { apiFormat: 'claude', baseUrl: 'https://api.anthropic.com' }, 'claude-opus-5-5', {})
    const names = claude.tools.map((t) => String(t.name))
    expect(names).toContain('str_replace_based_edit_tool')
    expect(names).toContain('bash')
    expect(names).not.toContain('edit_file')
    expect(names).not.toContain('read_file')
    expect(names).toContain('shell_exec') // background jobs stay available
    expect(claude.tools.filter((t) => t.cache_control)).toHaveLength(1)
    expect(claude.tools.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    expect(new Set(names).size).toBe(names.length)
    const oa = openAIToolsWithPatch(toolsToOpenAI([], { mode: 'build' }), 'gpt-5.4')
    const oaNames = oa.tools.map((t) => (t.function as { name: string }).name)
    expect(oaNames).toContain('apply_patch')
    expect(oaNames).not.toContain('edit_file')
    expect(oa.note).toContain('apply_patch')
    expect(openAIToolsWithPatch(toolsToOpenAI([], { mode: 'build' }), 'deepseek-v4').note).toBe('')
  })

  it('maps native calls onto Pawn tools for safety, permissions and policies', () => {
    expect(effectiveToolName(call('str_replace_based_edit_tool', { command: 'view', path: 'a' }))).toBe('read_file')
    expect(effectiveToolName(call('str_replace_based_edit_tool', { command: 'create', path: 'a' }))).toBe('write_file')
    expect(effectiveToolName(call('str_replace_based_edit_tool', { command: 'insert', path: 'a' }))).toBe('edit_file')
    expect(effectiveToolName(call('bash', { command: 'ls' }))).toBe('shell_exec')
    expect(effectiveToolName({ name: 'left_click', toolset: 'computer', arguments: {} })).toBe('computer_left_click')
    expect(isFileMutation(call('str_replace_based_edit_tool', { command: 'view' }))).toBe(false)
    expect(isFileMutation(call('apply_patch', { input: '' }))).toBe(true)
    expect(callPaths(call('apply_patch', { input: '*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n*** Delete File: c.ts\n*** End Patch' }))).toEqual(['a.ts', 'b.ts', 'c.ts'])
    const readOnly = { name: 'explore', tools: ['read_file', 'grep_search'] } as any
    const budget = { total: 0, edits: 0, shell: 0 }
    expect(checkSubagentToolCall(call('str_replace_based_edit_tool', { command: 'view', path: 'src/a.ts' }), readOnly, budget).allowed).toBe(true)
    expect(checkSubagentToolCall(call('str_replace_based_edit_tool', { command: 'str_replace', path: 'src/a.ts' }), readOnly, budget).allowed).toBe(false)
    expect(checkSubagentToolCall(call('apply_patch', { input: '' }), readOnly, budget).allowed).toBe(false)
  })
})

describe('Claude text editor tool', () => {
  it('views files with line numbers and ranges, and directories as a tree', async () => {
    const v = await executeTool(call('str_replace_based_edit_tool', { command: 'view', path: 'src/app.ts' }), ROOT, undefined, ctx)
    expect(v.isError).toBeFalsy()
    expect(v.content).toBe('     1\texport function add(a: number, b: number) {\n     2\t  return a + b\n     3\t}\n     4\t')
    const r = await executeTool(call('str_replace_based_edit_tool', { command: 'view', path: 'src/app.ts', view_range: [2, -1] }), ROOT, undefined, ctx)
    expect(r.content.startsWith('     2\t  return a + b')).toBe(true)
    const d = await executeTool(call('str_replace_based_edit_tool', { command: 'view', path: '.' }), ROOT, undefined, ctx)
    expect(d.content).toContain('src/')
    expect(d.content).toContain('  app.ts')
    const missing = await executeTool(call('str_replace_based_edit_tool', { command: 'view', path: 'nope.ts' }), ROOT, undefined, ctx)
    expect(missing.isError).toBe(true)
    expect(missing.content).toMatch(/^Error: /)
  })

  it('creates, replaces (unique match) and inserts through the change ledger', async () => {
    const c = await executeTool(call('str_replace_based_edit_tool', { command: 'create', path: 'src/new.ts', file_text: 'export const x = 1\n' }), ROOT, undefined, ctx)
    expect(c.isError).toBeFalsy()
    expect(files.get(`${ROOT}/src/new.ts`)).toBe('export const x = 1\n')
    const s = await executeTool(call('str_replace_based_edit_tool', { command: 'str_replace', path: 'src/app.ts', old_str: 'return a + b', new_str: 'return a + b + 0' }), ROOT, undefined, ctx)
    expect(s.isError).toBeFalsy()
    expect(files.get(`${ROOT}/src/app.ts`)).toContain('return a + b + 0')
    const dup = await executeTool(call('str_replace_based_edit_tool', { command: 'str_replace', path: 'src/util.ts', old_str: 'export const', new_str: 'const' }), ROOT, undefined, ctx)
    expect(dup.isError).toBe(true)
    await executeTool(call('str_replace_based_edit_tool', { command: 'view', path: 'src/util.ts' }), ROOT, undefined, ctx)
    const ins = await executeTool(call('str_replace_based_edit_tool', { command: 'insert', path: 'src/util.ts', insert_line: 1, insert_text: 'export const ONE_AND_HALF = 1.5\n' }), ROOT, undefined, ctx)
    expect(ins.isError).toBeFalsy()
    expect(files.get(`${ROOT}/src/util.ts`)).toBe('export const ONE = 1\nexport const ONE_AND_HALF = 1.5\nexport const TWO = 2\n')
    const changed = useChangeLedger.getState().turns.at(-1)!.changes.map((ch) => ch.path.replace(`${ROOT}/`, '')).sort()
    expect(changed).toEqual(['src/app.ts', 'src/new.ts', 'src/util.ts'])
  })

  it('refuses a line insert into a file that changed since it was viewed', async () => {
    await executeTool(call('str_replace_based_edit_tool', { command: 'view', path: 'src/util.ts' }), ROOT, undefined, ctx)
    files.set(`${ROOT}/src/util.ts`, '// edited by the user\nexport const ONE = 1\nexport const TWO = 2\n')
    const ins = await executeTool(call('str_replace_based_edit_tool', { command: 'insert', path: 'src/util.ts', insert_line: 1, insert_text: 'x' }), ROOT, undefined, ctx)
    expect(ins.isError).toBe(true)
    expect(ins.content).toContain('changed on disk')
  })

  it('is read-only in Plan mode (view allowed, edits blocked)', async () => {
    useProviderStore.setState({ agentMode: 'plan' } as any)
    const v = await executeTool(call('str_replace_based_edit_tool', { command: 'view', path: 'src/app.ts' }), ROOT, undefined, ctx)
    expect(v.isError).toBeFalsy()
    const e = await executeTool(call('str_replace_based_edit_tool', { command: 'create', path: 'x.ts', file_text: '' }), ROOT, undefined, ctx)
    expect(e.isError).toBe(true)
    expect(e.content).toContain('Plan mode')
    const b = await executeTool(call('bash', { command: 'rm -rf build' }), ROOT, undefined, ctx)
    expect(b.isError).toBe(true)
  })
})

describe('Claude bash tool', () => {
  it('runs in the per-session persistent shell and restarts on request', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, text: 'hello', exitCode: 0 })
    const restart = vi.fn().mockResolvedValue({ ok: true, text: 'Bash session restarted.' })
    ;(window as any).api.bash = { run, restart, kill: vi.fn() }
    const r = await executeTool(call('bash', { command: 'echo hello' }), ROOT, undefined, ctx)
    expect(r).toMatchObject({ content: 'hello', isError: false })
    expect(run).toHaveBeenCalledWith('s1', 'echo hello', expect.objectContaining({ cwd: ROOT, sandbox: expect.objectContaining({ projectRoot: ROOT }) }))
    run.mockResolvedValueOnce({ ok: true, text: 'grep: nothing\n[exit code: 1]', exitCode: 1 })
    expect((await executeTool(call('bash', { command: 'grep x y' }), ROOT, undefined, ctx)).isError).toBe(true)
    const rs = await executeTool(call('bash', { restart: true }), ROOT, undefined, ctx)
    expect(rs.content).toContain('restarted')
    expect(restart).toHaveBeenCalledWith('s1', ROOT, expect.any(Object))
  })

  it('falls back to a one-shot shell where sessions are unavailable', async () => {
    ;(window as any).api.shell.exec.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    const r = await executeTool(call('bash', { command: 'echo ok' }), ROOT, undefined, ctx)
    expect(r.content).toBe('ok')
  })
})

describe('apply_patch', () => {
  it('adds, updates, moves and deletes files in one transaction', async () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/sub.ts',
      '+export const sub = (a: number, b: number) => a - b',
      '*** Update File: src/app.ts',
      '*** Move to: src/math.ts',
      '@@ export function add(a: number, b: number) {',
      '-  return a + b',
      '+  return Number(a) + Number(b)',
      '*** Delete File: README.md',
      '*** End Patch'
    ].join('\n')
    const r = await executeTool(call('apply_patch', { input: patch }), ROOT, undefined, ctx)
    expect(r.isError, r.content).toBeFalsy()
    expect(r.content).toContain('A src/sub.ts')
    expect(r.content).toContain('M src/app.ts -> src/math.ts')
    expect(r.content).toContain('D README.md')
    expect(files.get(`${ROOT}/src/math.ts`)).toContain('return Number(a) + Number(b)')
    expect(files.has(`${ROOT}/src/app.ts`)).toBe(false)
    expect(files.has(`${ROOT}/README.md`)).toBe(false)
    expect(files.get(`${ROOT}/src/sub.ts`)).toBe('export const sub = (a: number, b: number) => a - b\n')
    // Every file is undoable.
    expect(useChangeLedger.getState().turns.at(-1)!.changes).toHaveLength(4)
  })

  it('validates everything before writing and rolls back on a write failure', async () => {
    const before = new Map(files)
    const bad = '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-  return a * b\n+  return 0\n*** End Patch'
    const r = await executeTool(call('apply_patch', { input: bad }), ROOT, undefined, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('src/app.ts')
    expect(files).toEqual(before)

    failWrites.add(`${ROOT}/src/util.ts`)
    const two = '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-  return a + b\n+  return b + a\n*** Update File: src/util.ts\n@@\n-export const TWO = 2\n+export const TWO = 2.0\n*** End Patch'
    const w = await executeTool(call('apply_patch', { input: two }), ROOT, undefined, ctx)
    expect(w.isError).toBe(true)
    expect(w.content).toContain('rolled back')
    expect(files.get(`${ROOT}/src/app.ts`)).toBe(before.get(`${ROOT}/src/app.ts`))

    const exists = await executeTool(call('apply_patch', { input: '*** Begin Patch\n*** Add File: src/util.ts\n+x\n*** End Patch' }), ROOT, undefined, ctx)
    expect(exists.content).toContain('already exists')
    const plan = await (async () => {
      useProviderStore.setState({ agentMode: 'plan' } as any)
      return executeTool(call('apply_patch', { input: two }), ROOT, undefined, ctx)
    })()
    expect(plan.content).toContain('Plan mode')
  })
})

describe('LSP text edits', () => {
  it('applies non-overlapping edits by line/column and rejects overlaps', () => {
    const text = 'const a = 1\nconst b = a + a\n'
    const r = applyTextEdits(text, [
      { startLine: 1, startColumn: 7, endLine: 1, endColumn: 8, newText: 'total' },
      { startLine: 2, startColumn: 11, endLine: 2, endColumn: 12, newText: 'total' },
      { startLine: 2, startColumn: 15, endLine: 2, endColumn: 16, newText: 'total' }
    ])
    expect(r).toEqual({ ok: true, text: 'const total = 1\nconst b = total + total\n' })
    expect(applyTextEdits(text, [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 5, newText: '' }, { startLine: 1, startColumn: 3, endLine: 1, endColumn: 6, newText: '' }]).ok).toBe(false)
    expect(applyTextEdits('x', [{ startLine: 1, startColumn: 2, endLine: 1, endColumn: 2, newText: '\nimport y' }])).toEqual({ ok: true, text: 'x\nimport y' })
  })
})
