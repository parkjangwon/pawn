// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { executeTool } from '../../agent/toolExecutor'
import { getProjectTarget, targetSandboxOpts, effectiveProjectPath } from '../../agent/executionTarget'
import { useAppStore, type Project } from '../../stores/app'
import { useProviderStore } from '../../stores/provider'

function projectWith(host: string, remotePath: string): Project {
  return {
    id: 'p1',
    name: 'P',
    paths: ['/home/me/app'],
    executionHost: host,
    remotePath,
    sessions: [{ id: 's1', title: 'T', path: '', createdAt: 1, messages: [] }]
  }
}

beforeEach(() => {
  useProviderStore.setState({ permissionMode: 'yolo' })
  useAppStore.setState({
    initialized: true,
    projects: [projectWith('h123', '/srv/app')],
    activeProjectId: 'p1',
    activeSessionId: 's1'
  })
})

describe('executionTarget helpers', () => {
  it('resolves the target from the project', () => {
    expect(getProjectTarget('p1')).toEqual({ hostId: 'h123', remotePath: '/srv/app' })
    expect(targetSandboxOpts('p1')).toEqual({ hostId: 'h123' })
  })

  it('swaps the project path to the remote repo path', () => {
    expect(effectiveProjectPath('p1', '/home/me/app')).toBe('/srv/app')
  })

  it('stays local for projects without a host', () => {
    useAppStore.setState({ projects: [projectWith('', '')] })
    expect(getProjectTarget('p1')).toEqual({})
    expect(targetSandboxOpts('p1')).toEqual({})
    expect(effectiveProjectPath('p1', '/home/me/app')).toBe('/home/me/app')
  })
})

describe('remote project tool guard', () => {
  it('refuses local-only tools with an explicit message', async () => {
    const res = await executeTool({ id: 't1', name: 'read_file', arguments: { path: '/srv/app/index.ts' } }, '/home/me/app', undefined, { projectId: 'p1', sessionId: 's1' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('executes on host "h123"')
  })

  it('refuses prefixed local tools (lsp/debug/worktree)', async () => {
    for (const name of ['lsp_diagnostics', 'debug_start', 'worktree_create']) {
      const res = await executeTool({ id: 't2', name, arguments: {} }, '/home/me/app', undefined, { projectId: 'p1', sessionId: 's1' })
      expect(res.isError).toBe(true)
      expect(res.content).toContain('h123')
    }
  })

  it('does not refuse shell tools (routing happens in main)', async () => {
    // Mock the shell IPC: the tool runs, carrying the hostId the main process
    // routes on. The guard's job is only to NOT refuse shell tools.
    let captured: unknown
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      ...window.api,
      shell: {
        exec: (_cmd: string, _cwd: string | undefined, _t: number, opts?: { hostId?: string }) => {
          captured = opts
          return Promise.resolve({ stdout: 'hi\n', stderr: '', exitCode: 0 })
        },
        killAll: () => Promise.resolve()
      },
      hooks: {}
    }
    const res = await executeTool(
      { id: 't3', name: 'shell_exec', arguments: { command: 'echo hi' } },
      '/home/me/app',
      undefined,
      { projectId: 'p1', sessionId: 's1' }
    )
    expect(res.isError ?? false).toBe(false)
    expect(res.content).toContain('hi')
    expect(res.content).not.toContain('executes on host')
    expect(captured).toMatchObject({ hostId: 'h123' })
  })
})
