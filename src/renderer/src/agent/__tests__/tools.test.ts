// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TOOLS, TOOL_SAFETY, executeTool, matchesGlob, type ToolCall } from '../tools'
import { useProviderStore } from '../../stores/provider'
import { usePermissionStore } from '../../stores/permission'
import { useThemeStore } from '../../stores/theme'

const fsMock = {
  readFile: vi.fn(),
  readFiles: vi.fn(),
  writeFile: vi.fn(),
  listDir: vi.fn(),
  walk: vi.fn(),
  exists: vi.fn()
}

const shellMock = { exec: vi.fn(), execFile: vi.fn() }
const routineMock = {
  list: vi.fn(),
  add: vi.fn(),
  setEnabled: vi.fn()
}
const browserApi = {
  ensure: vi.fn(),
  navigate: vi.fn(),
  open: vi.fn(),
  snapshot: vi.fn(),
  click: vi.fn(),
  fill: vi.fn(),
  readText: vi.fn(),
  eval: vi.fn(),
  back: vi.fn(),
  screenshot: vi.fn()
}

beforeEach(() => {
  ;(window as any).api = {
    fs: fsMock,
    shell: shellMock,
    computer: {
      screenshot: vi.fn(),
      click: vi.fn(),
      type: vi.fn(),
      keypress: vi.fn().mockResolvedValue({ ok: true })
    }
  }
  useProviderStore.setState({ permissionMode: 'ask' })
  usePermissionStore.setState({ pending: [] })
  for (const fn of Object.values(fsMock)) fn.mockReset()
  fsMock.readFiles.mockImplementation((paths: string[]) =>
    Promise.all(paths.map(async (p: string) => {
      const r = await fsMock.readFile(p)
      return typeof r === 'string' ? { path: p, content: r } : { path: p, error: String(r?.error || 'read failed') }
    }))
  )
  shellMock.exec.mockReset()
  shellMock.execFile.mockReset()
  routineMock.list.mockReset()
  routineMock.add.mockReset()
  routineMock.setEnabled.mockReset()
})

const call = (name: string, args: Record<string, unknown> = {}, id = 'call-1'): ToolCall => ({ id, name, arguments: args })

describe('tool safety table', () => {
  it('covers every registered tool', () => {
    for (const tool of TOOLS) {
      expect(TOOL_SAFETY[tool.name], tool.name).toBeDefined()
    }
  })
})

describe('matchesGlob', () => {
  it('matches across path segments with **', () => {
    expect(matchesGlob('src/deep/nested/a.ts', '**/*.ts')).toBe(true)
    expect(matchesGlob('src/a.ts', '**/*.ts')).toBe(true)
  })

  it('keeps * within a single segment', () => {
    expect(matchesGlob('src/a.ts', 'src/*.ts')).toBe(true)
    expect(matchesGlob('src/deep/a.ts', 'src/*.ts')).toBe(false)
  })

  it('is case-insensitive and supports ?', () => {
    expect(matchesGlob('README.MD', 'readme.md')).toBe(true)
    expect(matchesGlob('file1.ts', 'file?.ts')).toBe(true)
    expect(matchesGlob('file10.ts', 'file?.ts')).toBe(false)
  })
})

async function waitForPending(n = 1): Promise<void> {
  await vi.waitFor(() => {
    expect(usePermissionStore.getState().pending).toHaveLength(n)
  })
}

describe('permission gating', () => {
  it('denies when the user rejects in ask mode', async () => {
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const promise = executeTool(call('write_file', { path: '/x.ts', content: 'c' }))
    await waitForPending(1)
    const pending = usePermissionStore.getState().pending[0]
    expect(pending.type).toBe('file_write')
    usePermissionStore.getState().resolve(pending.id, false)
    const result = await promise
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Permission denied')
    expect(fsMock.writeFile).not.toHaveBeenCalled()
  })

  it('aborts a pending permission request when the signal fires', async () => {
    const controller = new AbortController()
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const promise = executeTool(call('write_file', { path: '/x.ts', content: 'c' }), undefined, controller.signal)
    await waitForPending(1)

    controller.abort()
    const result = await promise
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Permission denied')
    expect(fsMock.writeFile).not.toHaveBeenCalled()
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })

  it('skips execution entirely for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await executeTool(call('write_file', { path: '/x.ts', content: 'c' }), undefined, controller.signal)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('aborted')
    expect(fsMock.writeFile).not.toHaveBeenCalled()
  })

  it('auto mode approves safe tools without asking', async () => {
    useProviderStore.setState({ permissionMode: 'auto' })
    fsMock.readFile.mockResolvedValue('content')
    const result = await executeTool(call('read_file', { path: '/a.ts' }))
    expect(usePermissionStore.getState().pending).toHaveLength(0)
    expect(result.content).toBe('content')
  })

  it('auto mode still asks for risky tools', async () => {
    useProviderStore.setState({ permissionMode: 'auto' })
    fsMock.readFile.mockResolvedValue('old')
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const promise = executeTool(call('write_file', { path: '/x.ts', content: 'c' }))
    await waitForPending(1)
    usePermissionStore.getState().resolve(usePermissionStore.getState().pending[0].id, true)
    const result = await promise
    expect(result.content).toContain('File written')
  })

  it('yolo mode skips permission checks entirely', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('old')
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const result = await executeTool(call('write_file', { path: '/x.ts', content: 'c' }))
    expect(usePermissionStore.getState().pending).toHaveLength(0)
    expect(result.content).toContain('File written')
  })
})

describe('file tools', () => {
  it('reads a file', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('file body')
    const result = await executeTool(call('read_file', { path: '/a.ts' }))
    expect(result.content).toBe('file body')
  })

  it('suggests similar names when a file is missing', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue({ error: 'ENOENT' })
    fsMock.listDir.mockResolvedValue([
      { name: 'app.ts', path: '/src/app.ts', isDirectory: false },
      { name: 'main.ts', path: '/src/main.ts', isDirectory: false }
    ])
    const result = await executeTool(call('read_file', { path: '/src/app.ts' }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Did you mean')
    expect(result.content).toContain('/src/app.ts')
  })

  it('writes a new file without diff data', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue({ error: 'ENOENT' })
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const result = await executeTool(call('write_file', { path: '/new.ts', content: 'x' }))
    expect(result.content).toContain('File created')
    expect(result.diffData).toMatchObject({ oldText: '', newText: 'x', filename: 'new.ts', path: '/new.ts' })
  })

  it('returns diff data when overwriting an existing file', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('old content')
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const result = await executeTool(call('write_file', { path: '/a.ts', content: 'new content' }))
    expect(result.diffData).toEqual({ oldText: 'old content', newText: 'new content', filename: 'a.ts', path: '/a.ts' })
  })

  it('edits a file with unique old_string and returns diff data', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('one two three')
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const result = await executeTool(call('edit_file', { path: '/a.ts', old_string: 'two', new_string: 'TWO' }))
    expect(result.content).toContain('File edited')
    expect(result.diffData).toEqual({ oldText: 'one two three', newText: 'one TWO three', filename: 'a.ts', path: '/a.ts' })
  })

  it('fails when old_string is missing or ambiguous', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('one two two')

    const missing = await executeTool(call('edit_file', { path: '/a.ts', old_string: 'zzz', new_string: 'x' }))
    expect(missing.isError).toBe(true)
    expect(missing.content).toContain('not found')

    const ambiguous = await executeTool(call('edit_file', { path: '/a.ts', old_string: 'two', new_string: 'x' }))
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.content).toContain('times')
  })

  it('supports replace_all for multi-occurrence edits', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('one two two')
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const result = await executeTool(
      call('edit_file', { path: '/a.ts', old_string: 'two', new_string: 'TWO', replace_all: true })
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('2 replacement')
    expect(fsMock.writeFile).toHaveBeenCalledWith('/a.ts', 'one TWO TWO')
  })

  it('flex-matches whitespace when exact old_string misses', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('foo  bar\nbaz\n')
    fsMock.writeFile.mockResolvedValue({ ok: true })
    const result = await executeTool(
      call('edit_file', { path: '/a.ts', old_string: 'foo bar\nbaz', new_string: 'qux' })
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toMatch(/flex|edited/i)
    expect(fsMock.writeFile).toHaveBeenCalled()
  })

  it('deletes files', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    const del = vi.fn().mockResolvedValue({ ok: true })
    ;(window as any).api.fs.delete = del
    const result = await executeTool(call('delete_file', { path: 'tmp.txt' }), '/proj')
    expect(del).toHaveBeenCalledWith('/proj/tmp.txt')
    expect(result.content).toContain('Deleted')
  })

  it('resolves relative paths against the project root', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.readFile.mockResolvedValue('body')
    const result = await executeTool(call('read_file', { path: 'src/a.ts' }), '/home/proj')
    expect(fsMock.readFile).toHaveBeenCalledWith('/home/proj/src/a.ts')
    expect(result.content).toBe('body')
  })

  it('pages large reads with offset/limit', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    const body = Array.from({ length: 20 }, (_, i) => `L${i + 1}`).join('\n')
    fsMock.readFile.mockResolvedValue(body)
    const result = await executeTool(call('read_file', { path: '/a.ts', offset: 5, limit: 3 }))
    expect(result.content).toContain('lines 5-7 of 20')
    expect(result.content).toContain('L5')
    expect(result.content).toContain('L7')
  })

  it('lists a directory', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.listDir.mockResolvedValue([
      { name: 'src', path: '/p/src', isDirectory: true },
      { name: 'readme.md', path: '/p/readme.md', isDirectory: false }
    ])
    const result = await executeTool(call('list_dir', { path: '/p' }))
    expect(result.content).toContain('[DIR] src')
    expect(result.content).toContain('[FILE] readme.md')
  })
})

describe('search tools', () => {
  it('finds files by glob pattern relative to the root', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.walk.mockResolvedValue([
      { path: '/p/src/a.ts', name: 'a.ts', isDirectory: false },
      { path: '/p/src/deep/b.ts', name: 'b.ts', isDirectory: false },
      { path: '/p/readme.md', name: 'readme.md', isDirectory: false }
    ])
    const result = await executeTool(call('search_files', { pattern: '**/*.ts' }), '/p')
    expect(result.content).toContain('Found 2 files')
    expect(result.content).toContain('/p/src/deep/b.ts')
  })

  it('greps with case_insensitive and fixed_string', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.walk.mockResolvedValue([{ path: '/p/a.ts', name: 'a.ts', isDirectory: false }])
    fsMock.readFiles.mockResolvedValue([{ path: '/p/a.ts', content: 'Hello World\nfoo\n' }])
    const result = await executeTool(
      call('grep_search', { query: 'hello', case_insensitive: true, fixed_string: true }),
      '/p'
    )
    expect(result.content).toContain('Hello World')
    expect(result.content).toMatch(/a\.ts:1:/)
  })

  it('runs git_status via execFile', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    shellMock.execFile
      .mockResolvedValueOnce({ stdout: 'main\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '## main\n M src/a.ts\n', stderr: '', exitCode: 0 })
    const result = await executeTool(call('git_status'), '/p')
    expect(result.content).toContain('branch: main')
    expect(result.content).toContain('M src/a.ts')
    expect(shellMock.execFile).toHaveBeenCalledWith('git', expect.any(Array), '/p', expect.any(Number))
  })

  it('presses computer keys', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    const result = await executeTool(call('computer_keypress', { key: 'Return' }))
    expect(result.content).toContain('Return')
    expect((window as any).api.computer.keypress).toHaveBeenCalledWith('Return')
  })

  it('reports no matches', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.walk.mockResolvedValue([{ path: '/p/readme.md', name: 'readme.md', isDirectory: false }])
    const result = await executeTool(call('search_files', { pattern: '*.css' }), '/p')
    expect(result.content).toContain('No files found')
  })

  it('matches Windows-style paths with forward-slash globs', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.walk.mockResolvedValue([
      { path: 'C:\\proj\\src\\a.ts', name: 'a.ts', isDirectory: false },
      { path: 'C:\\proj\\src\\deep\\b.ts', name: 'b.ts', isDirectory: false }
    ])
    const result = await executeTool(call('search_files', { pattern: 'src/*.ts' }), 'C:\\proj')
    expect(result.content).toContain('C:\\proj\\src\\a.ts')
    expect(result.content).not.toContain('deep')
  })

  it('greps file contents and reports line matches', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.walk.mockResolvedValue([
      { path: '/p/a.ts', name: 'a.ts', isDirectory: false },
      { path: '/p/b.ts', name: 'b.ts', isDirectory: false }
    ])
    fsMock.readFile.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('a.ts') ? 'line1\nconst x = 1\nline3' : 'nothing')
    )
    const result = await executeTool(call('grep_search', { query: 'const x' }), '/p')
    expect(result.content).toContain('/p/a.ts:2: const x = 1')
    expect(result.content).not.toContain('b.ts')
  })

  it('rejects invalid regex patterns', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    fsMock.walk.mockResolvedValue([{ path: '/p/a.ts', name: 'a.ts', isDirectory: false }])
    const result = await executeTool(call('grep_search', { query: '[' }), '/p')
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Invalid regex')
  })
})

describe('shell tool', () => {
  it('runs a command and reports failures', async () => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    shellMock.exec.mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 })
    const ok = await executeTool(call('shell_exec', { command: 'echo hello' }))
    expect(ok.content).toBe('hello')
    expect(ok.isError).toBe(false)

    shellMock.exec.mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 })
    const bad = await executeTool(call('shell_exec', { command: 'false' }))
    expect(bad.isError).toBe(true)
    expect(bad.content).toBe('boom')
  })
})

describe('browser tools', () => {
  beforeEach(() => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    for (const fn of Object.values(browserApi)) fn.mockReset()
    ;(window as any).api = {
      fs: fsMock,
      shell: shellMock,
      browser: browserApi,
      platform: 'darwin'
    }
    browserApi.ensure.mockResolvedValue({})
    browserApi.open.mockResolvedValue({})
    ;(window as any).__openRightPanelTab = vi.fn()
  })

  it('navigates and reports the loaded URL and title', async () => {
    browserApi.navigate.mockResolvedValue({ url: 'https://x.dev', title: 'X Dev' })
    const result = await executeTool(call('browser_navigate', { url: 'https://x.dev' }))
    expect(result.content).toContain('https://x.dev')
    expect(result.content).toContain('X Dev')
  })

  it('reports navigation failures', async () => {
    browserApi.navigate.mockResolvedValue({ error: 'timeout' })
    const result = await executeTool(call('browser_navigate', { url: 'https://x.dev' }))
    expect(result.isError).toBe(true)
    expect(result.content).toBe('timeout')
  })

  it('opens external URLs in the system browser', async () => {
    const result = await executeTool(call('browser_open_external', { url: 'https://example.com' }))
    expect(result.content).toContain('Opened in the system browser')
    expect(browserApi.open).toHaveBeenCalledWith('https://example.com')
  })
})

describe('research tools', () => {
  const researchApi = {
    fetch: vi.fn(),
    research: vi.fn()
  }

  beforeEach(() => {
    researchApi.fetch.mockReset()
    researchApi.research.mockReset()
    ;(window as any).api = {
      ...(window as any).api,
      research: researchApi
    }
    useProviderStore.setState({ permissionMode: 'yolo' })
  })

  it('web_fetch returns research text', async () => {
    researchApi.fetch.mockResolvedValue({
      ok: true,
      text: 'ok=true\n\n[BEGIN UNTRUSTED WEB CONTENT]\nHello\n[END UNTRUSTED WEB CONTENT]'
    })
    const result = await executeTool(call('web_fetch', { url: 'https://example.com' }))
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Hello')
    expect(researchApi.fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ deviceClass: 'auto' })
    )
  })

  it('web_research requires query or urls', async () => {
    const result = await executeTool(call('web_research', {}))
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/query|urls/i)
  })

  it('web_research passes query', async () => {
    researchApi.research.mockResolvedValue({ ok: true, text: '# Research: AI\nok=1' })
    const result = await executeTool(call('web_research', { query: 'AI agents', max_sources: 3 }))
    expect(result.content).toContain('Research')
    expect(researchApi.research).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'AI agents', maxSources: 3 })
    )
  })
})

describe('app tools', () => {
  beforeEach(() => {
    useProviderStore.setState({ permissionMode: 'yolo' })
    ;(window as any).__openRightPanelTab = vi.fn()
    ;(window as any).__closeRightPanelTab = vi.fn()
    ;(window as any).api = {
      config: { save: vi.fn().mockResolvedValue({}), load: vi.fn() },
      fs: fsMock,
      routine: routineMock
    }
  })

  it('opens and closes right-panel tabs through the window bridges', async () => {
    const opened = await executeTool(call('app_open_tab', { tab: 'terminal' }))
    expect(opened.content).toContain('Opened right panel')
    expect((window as any).__openRightPanelTab).toHaveBeenCalledWith('terminal')

    const closed = await executeTool(call('app_close_tab', { tab: 'diff' }))
    expect((window as any).__closeRightPanelTab).toHaveBeenCalledWith('diff')
    expect(closed.content).toContain('Closed tab')
  })

  it('rejects unknown tabs', async () => {
    const result = await executeTool(call('app_open_tab', { tab: 'nope' }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tab')
  })

  it('sets the model to auto or a configured model', async () => {
    useProviderStore.setState({
      models: [{ id: 'p1:gpt-4o', providerId: 'p1', modelId: 'gpt-4o', label: 'GPT-4o', tier: 'mid', enabled: true }]
    })
    const auto = await executeTool(call('app_set_model', { model: 'auto' }))
    expect(auto.content).toContain('auto')
    expect(useProviderStore.getState().activeModelId).toBeNull()
    expect(useProviderStore.getState().routingMode).toBe('auto')

    await executeTool(call('app_set_model', { model: 'GPT-4o' }))
    expect(useProviderStore.getState().activeModelId).toBe('p1:gpt-4o')
    expect(useProviderStore.getState().routingMode).toBe('manual')
  })

  it('changes the permission mode through the provider store', async () => {
    const result = await executeTool(call('app_set_permission_mode', { mode: 'yolo' }))
    expect(result.content).toBe('Permission mode set to yolo')
    expect(useProviderStore.getState().permissionMode).toBe('yolo')
  })

  it('toggles the theme', async () => {
    useThemeStore.setState({ theme: 'dark' })
    const result = await executeTool(call('app_toggle_theme', {}))
    expect(result.content).toBe('Theme toggled')
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('sets reasoning effort and rejects bad values', async () => {
    const ok = await executeTool(call('app_set_reasoning', { effort: 'high' }))
    expect(ok.content).toBe('Reasoning effort set to high')
    expect(useProviderStore.getState().reasoningEffort).toBe('high')

    const bad = await executeTool(call('app_set_reasoning', { effort: 'insane' }))
    expect(bad.isError).toBe(true)
  })

  it('lists automations through app API', async () => {
    routineMock.list.mockResolvedValue([
      {
        id: 'r1',
        name: 'Daily report',
        schedule: JSON.stringify({ type: 'daily', hour: 9, minute: 0 }),
        prompt: 'write report',
        projectId: '',
        sessionId: '',
        enabled: true,
        nextRunAt: 0,
        lastRunAt: 0,
        lastResult: '',
        createdAt: 0
      }
    ])
    const result = await executeTool(call('app_list_automations', {}))
    expect(result.content).toContain('Automations (1)')
    expect(result.content).toContain('Daily report')
  })

  it('creates automations without SQL and supports manual mode', async () => {
    routineMock.add.mockResolvedValue({ ok: true })
    routineMock.setEnabled.mockResolvedValue({ ok: true })

    const daily = await executeTool(call('app_create_automation', {
      name: 'Issue triage',
      prompt: 'Review latest issues',
      scheduleType: 'daily',
      hour: 10,
      minute: 15
    }))
    expect(daily.isError).not.toBe(true)
    expect(routineMock.add).toHaveBeenCalledTimes(1)
    expect(routineMock.setEnabled).not.toHaveBeenCalled()

    const addArg = routineMock.add.mock.calls[0][0]
    const parsed = JSON.parse(addArg.schedule)
    expect(parsed).toMatchObject({ type: 'daily', hour: 10, minute: 15 })

    const manual = await executeTool(call('app_create_automation', {
      name: 'Manual audit',
      prompt: 'Audit open PRs',
      scheduleType: 'manual'
    }))
    expect(manual.isError).not.toBe(true)
    expect(routineMock.setEnabled).toHaveBeenCalledTimes(1)
  })

  it('reports unknown tools', async () => {
    const result = await executeTool(call('not_a_tool', {}))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tool')
  })
})
