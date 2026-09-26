// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatDiagnostics, lspSupports, postEditDiagnostics } from '../toolHandlers/lsp'
import { executeTool } from '../toolExecutor'
import { useProviderStore } from '../../stores/provider'
import { __resetFileSnapshotsForTests } from '../fileSnapshots'

const err = (line: number, message: string, code?: number): LspDiagnosticDto => ({
  line,
  column: 3,
  severity: 'error',
  message,
  source: 'typescript',
  ...(code ? { code } : {})
})

describe('formatDiagnostics', () => {
  it('summarizes errors with project-relative paths and TS codes', () => {
    const out = formatDiagnostics(
      [{ path: '/p/src/a.ts', diagnostics: [err(2, "Type 'number' is not assignable to type 'string'.", 2322)] }],
      { root: '/p' }
    )
    expect(out).toBe("1 error\nsrc/a.ts:2:3 error TS2322: Type 'number' is not assignable to type 'string'.")
  })

  it('counts warnings but only lists them on request', () => {
    const files = [
      {
        path: '/p/a.ts',
        diagnostics: [{ line: 1, column: 1, severity: 'warning' as const, message: 'unused' }]
      }
    ]
    expect(formatDiagnostics(files, { root: '/p' })).toBe('no errors (1 warning)')
    expect(formatDiagnostics(files, { root: '/p', includeWarnings: true })).toContain('a.ts:1:1 warning: unused')
  })

  it('caps the listing', () => {
    const many = Array.from({ length: 30 }, (_, i) => err(i + 1, `e${i}`))
    const out = formatDiagnostics([{ path: '/p/a.ts', diagnostics: many }], { root: '/p' })
    expect(out.split('\n')[0]).toBe('30 errors')
    expect(out).toContain('…18 more')
  })

  it('knows which files a server can check', () => {
    expect(lspSupports('/a/b.tsx')).toBe(true)
    expect(lspSupports('/a/b.py')).toBe(true)
    expect(lspSupports('/a/README.md')).toBe(false)
  })
})

describe('post-edit diagnostics', () => {
  const diagnostics = vi.fn()
  beforeEach(() => {
    __resetFileSnapshotsForTests()
    diagnostics.mockReset()
    useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {}, lspDiagnostics: true } as any)
  })

  function mountApi(fs: Record<string, unknown>): void {
    ;(window as any).api = { fs, lsp: { diagnostics } }
  }

  it('appends real type errors to edit_file results', async () => {
    mountApi({
      readFile: vi.fn().mockResolvedValue('const n: string = "a"\n'),
      writeFile: vi.fn().mockResolvedValue({ ok: true })
    })
    diagnostics.mockResolvedValue({
      ok: true,
      files: [{ path: '/p/a.ts', fresh: true, diagnostics: [err(1, "Type 'number' is not assignable", 2322)] }]
    })
    const r = await executeTool(
      { id: '1', name: 'edit_file', arguments: { path: '/p/a.ts', old_string: '"a"', new_string: '1' } },
      '/p'
    )
    expect(r.content).toContain('[lsp] 1 error')
    expect(r.content).toContain('a.ts:1:3 error TS2322')
    // Checks the new content before it is re-read from disk.
    expect(diagnostics).toHaveBeenCalledWith('/p', ['/p/a.ts'], {
      waitMs: 2500,
      content: { '/p/a.ts': 'const n: string = 1\n' }
    })
  })

  it('stays silent when disabled, unsupported, stale, or failing', async () => {
    mountApi({})
    expect(await postEditDiagnostics('/p/README.md', 'x', '/p')).toBe('')
    expect(await postEditDiagnostics('/p/a.ts', 'x', undefined)).toBe('')
    diagnostics.mockResolvedValue({ ok: true, files: [{ path: '/p/a.ts', fresh: false, diagnostics: [] }] })
    expect(await postEditDiagnostics('/p/a.ts', 'x', '/p')).toBe('')
    diagnostics.mockRejectedValue(new Error('boom'))
    expect(await postEditDiagnostics('/p/a.ts', 'x', '/p')).toBe('')
    useProviderStore.setState({ lspDiagnostics: false } as any)
    diagnostics.mockResolvedValue({ ok: true, files: [{ path: '/p/a.ts', fresh: true, diagnostics: [err(1, 'x')] }] })
    expect(await postEditDiagnostics('/p/a.ts', 'x', '/p')).toBe('')
  })

  it('confirms a clean file', async () => {
    mountApi({})
    diagnostics.mockResolvedValue({ ok: true, files: [{ path: '/p/a.ts', fresh: true, diagnostics: [] }] })
    expect(await postEditDiagnostics('/p/a.ts', 'x', '/p')).toBe('\n[lsp] no errors')
  })
})

describe('lsp tools', () => {
  beforeEach(() => {
    useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'plan', sessionAgentModes: {} } as any)
  })

  it('lists references (allowed in Plan mode)', async () => {
    ;(window as any).api = {
      lsp: {
        references: vi.fn().mockResolvedValue({
          ok: true,
          locations: [
            { path: '/p/src/a.ts', line: 3, column: 5, preview: 'route(x)' },
            { path: '/p/src/b.ts', line: 9, column: 1 }
          ]
        })
      }
    }
    const r = await executeTool({ id: '1', name: 'lsp_references', arguments: { path: 'src/a.ts', line: 3, column: 5 } }, '/p')
    expect(r.isError).toBeFalsy()
    expect(r.content).toBe('2 references:\nsrc/a.ts:3:5  route(x)\nsrc/b.ts:9:1')
  })

  it('points to run_checks when the server is unavailable', async () => {
    ;(window as any).api = {
      lsp: { diagnostics: vi.fn().mockResolvedValue({ ok: false, error: 'typescript-language-server not installed', files: [] }) }
    }
    const r = await executeTool({ id: '2', name: 'lsp_diagnostics', arguments: { paths: ['a.ts'] } }, '/p')
    expect(r.isError).toBe(true)
    expect(r.content).toContain('not installed')
    expect(r.content).toContain('run_checks')
  })

  it('validates positions', async () => {
    ;(window as any).api = { lsp: { definition: vi.fn() } }
    const r = await executeTool({ id: '3', name: 'lsp_definition', arguments: { path: 'a.ts', line: 0, column: 1 } }, '/p')
    expect(r.isError).toBe(true)
  })
})
