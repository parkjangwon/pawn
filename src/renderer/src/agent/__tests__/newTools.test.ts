// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TOOLS, TOOL_SAFETY, executeTool, type ToolCall } from '../tools'
import { useProviderStore } from '../../stores/provider'
import { usePermissionStore } from '../../stores/permission'
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: 'c1',
  name,
  arguments: args
})

describe('new tools registration', () => {
  it('registers every new tool with TOOL_SAFETY', () => {
    const names = [
      'web_search',
      'run_checks',
      'codebase_search',
      'git_pr_ready',
      'write_artifact',
      'list_artifacts',
      'terminal_list',
      'terminal_read',
      'github_review_pull',
      'github_draft_issue'
    ]
    for (const n of names) {
      expect(TOOLS.some((t) => t.name === n), n).toBe(true)
      expect(TOOL_SAFETY[n], n).toBeDefined()
    }
  })
})

describe('codebase_search / artifacts / terminal tools', () => {
  const fsMock = {
    walk: vi.fn(),
    readFiles: vi.fn(),
    exists: vi.fn(),
    listDir: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    contentSearch: vi.fn()
  }
  const shellMock = {
    exec: vi.fn(),
    execFile: vi.fn()
  }
  const researchMock = {
    search: vi.fn(),
    fetch: vi.fn(),
    research: vi.fn()
  }
  const terminalMock = {
    list: vi.fn(),
    readBuffer: vi.fn()
  }
  const connectionsMock = {
    runTool: vi.fn()
  }

  beforeEach(() => {
    ;(window as any).api = {
      fs: fsMock,
      shell: shellMock,
      research: researchMock,
      terminal: terminalMock,
      connections: connectionsMock
    }
    useProviderStore.setState({ permissionMode: 'yolo' })
    usePermissionStore.setState({ pending: [] })
    Object.values(fsMock).forEach((fn) => fn.mockReset())
    shellMock.exec.mockReset()
    shellMock.execFile.mockReset()
    researchMock.search.mockReset()
    terminalMock.list.mockReset()
    terminalMock.readBuffer.mockReset()
    connectionsMock.runTool.mockReset()
  })

  it('codebase_search finds a function definition', async () => {
    // Force walk fallback so the unit test does not depend on host rg/git.
    fsMock.contentSearch.mockResolvedValue({ engine: 'none', matches: [], truncated: false })
    fsMock.walk.mockResolvedValue([
      { name: 'app.ts', path: '/p/src/app.ts', isDirectory: false },
      { name: 'node_modules', path: '/p/node_modules/x', isDirectory: false }
    ])
    fsMock.readFiles.mockResolvedValue([
      {
        path: '/p/src/app.ts',
        content: 'export function fetchUrl() {\n  return 1\n}\nconst x = fetchUrl()\n'
      }
    ])
    const res = await executeTool(call('codebase_search', { query: 'fetchUrl' }), '/p')
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('fetchUrl')
    expect(res.content).toMatch(/Likely definitions|app\.ts/)
  })

  it('codebase_search uses fast contentSearch when available', async () => {
    fsMock.contentSearch.mockResolvedValue({
      engine: 'rg',
      truncated: false,
      matches: [
        { path: '/p/src/app.ts', line: 1, text: 'export function fetchUrl() {' }
      ]
    })
    const res = await executeTool(call('codebase_search', { query: 'fetchUrl' }), '/p')
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('fetchUrl')
    expect(res.content).toMatch(/engine=rg/)
    expect(fsMock.walk).not.toHaveBeenCalled()
  })

  it('write_artifact rejects path traversal', async () => {
    const res = await executeTool(
      call('write_artifact', { name: '../secret', content: 'x' }),
      '/p'
    )
    expect(res.isError).toBe(true)
    expect(res.content).toMatch(/Invalid/)
  })

  it('write_artifact writes under artifacts/', async () => {
    fsMock.mkdir.mockResolvedValue({ ok: true })
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const res = await executeTool(
      call('write_artifact', { name: 'notes/hi.md', content: 'hello' }),
      '/p'
    )
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('artifacts')
    expect(fsMock.writeFile).toHaveBeenCalled()
    const pathArg = fsMock.writeFile.mock.calls[0][0] as string
    expect(pathArg.replace(/\\/g, '/')).toContain('/p/artifacts/notes/hi.md')
  })

  it('web_search calls research.search', async () => {
    researchMock.search.mockResolvedValue({ ok: true, text: '# Web search: foo\n1. bar' })
    const res = await executeTool(call('web_search', { query: 'foo' }))
    expect(res.content).toContain('Web search')
    expect(researchMock.search).toHaveBeenCalledWith(expect.objectContaining({ query: 'foo' }))
  })

  it('terminal_read uses list fallback', async () => {
    terminalMock.list.mockResolvedValue({
      ok: true,
      terminals: [{ id: 't1', bufferChars: 10, alive: true }]
    })
    terminalMock.readBuffer.mockResolvedValue({
      ok: true,
      id: 't1',
      alive: true,
      text: 'error: boom',
      rawChars: 11,
      returnedChars: 11
    })
    const res = await executeTool(call('terminal_read', {}))
    expect(res.content).toContain('boom')
    expect(terminalMock.readBuffer).toHaveBeenCalledWith('t1', undefined)
  })

  it('github_review_pull routes to connections.runTool', async () => {
    connectionsMock.runTool.mockResolvedValue({ ok: true, text: 'PR pack' })
    const res = await executeTool(call('github_review_pull', { repo: 'a/b', number: 1 }))
    expect(res.content).toBe('PR pack')
    expect(connectionsMock.runTool).toHaveBeenCalledWith(
      'github_review_pull',
      expect.objectContaining({ repo: 'a/b', number: 1 })
    )
  })
})

