// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isMcpToolName, parseMcpToolName, getMcpToolDefinitions, callMcpTool,
  setDisabledMcpServers, clearMcpToolCache
} from '../mcp'

function mockApi(statuses: McpServerStatus[], callToolImpl?: (...args: unknown[]) => unknown): void {
  ;(window as any).api = {
    mcp: {
      listTools: vi.fn().mockResolvedValue(statuses),
      callTool: vi.fn(callToolImpl || (() => Promise.resolve({ content: 'ok' })))
    }
  }
}

beforeEach(() => {
  clearMcpToolCache()
  setDisabledMcpServers([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isMcpToolName / parseMcpToolName', () => {
  it('recognizes the mcp__<server>__<tool> convention', () => {
    expect(isMcpToolName('mcp__codegraph__codegraph_status')).toBe(true)
    expect(isMcpToolName('read_file')).toBe(false)
  })

  it('splits on the first __ so tool names may contain underscores', () => {
    expect(parseMcpToolName('mcp__codegraph__codegraph_status')).toEqual({
      serverId: 'codegraph',
      toolName: 'codegraph_status'
    })
  })

  it('returns null for non-mcp or malformed names', () => {
    expect(parseMcpToolName('read_file')).toBeNull()
    expect(parseMcpToolName('mcp__noSeparator')).toBeNull()
  })
})

describe('getMcpToolDefinitions', () => {
  it('maps connected servers into namespaced ToolDefinitions', async () => {
    mockApi([
      { id: 'codegraph', source: 'user-claude', status: 'connected', tools: [{ name: 'codegraph_status', description: 'status', inputSchema: { type: 'object' } }] },
      { id: 'flaky', source: 'user-claude', status: 'error', error: 'boom' }
    ])
    const defs = await getMcpToolDefinitions('/repo')
    expect(defs).toEqual([
      { name: 'mcp__codegraph__codegraph_status', description: 'status', parameters: { type: 'object' } }
    ])
  })

  it('excludes servers the user disabled in settings', async () => {
    mockApi([
      { id: 'codegraph', source: 'user-claude', status: 'connected', tools: [{ name: 'codegraph_status', description: 'status', inputSchema: {} }] }
    ])
    setDisabledMcpServers(['codegraph'])
    expect(await getMcpToolDefinitions('/repo')).toEqual([])
  })

  it('caches the catalog so a rapid second call does not re-invoke IPC', async () => {
    mockApi([{ id: 'codegraph', source: 'user-claude', status: 'connected', tools: [{ name: 't', description: '', inputSchema: {} }] }])
    await getMcpToolDefinitions('/repo')
    await getMcpToolDefinitions('/repo')
    expect(window.api.mcp!.listTools).toHaveBeenCalledTimes(1)
  })

  it('refetches once the cache TTL has elapsed', async () => {
    vi.useFakeTimers()
    mockApi([{ id: 'codegraph', source: 'user-claude', status: 'connected', tools: [{ name: 't', description: '', inputSchema: {} }] }])
    await getMcpToolDefinitions('/repo')
    await vi.advanceTimersByTimeAsync(61_000)
    await getMcpToolDefinitions('/repo')
    expect(window.api.mcp!.listTools).toHaveBeenCalledTimes(2)
  })

  it('degrades to an empty list when MCP is unavailable (e.g. browser mode)', async () => {
    ;(window as any).api = {}
    expect(await getMcpToolDefinitions('/repo')).toEqual([])
  })
})

describe('callMcpTool', () => {
  it('parses the tool name and forwards to window.api.mcp.callTool', async () => {
    mockApi([], () => Promise.resolve({ content: 'file list', isError: false }))
    const result = await callMcpTool('call-1', 'mcp__codegraph__codegraph_files', { path: '.' }, '/repo')
    expect(window.api.mcp!.callTool).toHaveBeenCalledWith('/repo', 'codegraph', 'codegraph_files', { path: '.' })
    expect(result).toEqual({ toolCallId: 'call-1', content: 'file list', isError: false })
  })

  it('rejects a malformed tool name without calling the IPC bridge', async () => {
    mockApi([])
    const result = await callMcpTool('call-2', 'mcp__oops', {})
    expect(result.isError).toBe(true)
    expect(window.api.mcp!.callTool).not.toHaveBeenCalled()
  })
})
