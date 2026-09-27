// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  __resetToolsetsForTests,
  activeToolGroups,
  groupOfTool,
  hiddenToolNames,
  isGroupAvailable,
  parseToolGroupArgs,
  refreshConnectedProviders,
  setConnectedProviders
} from '../toolsets'
import { TOOLS } from '../toolDefinitions'
import { toolsToOpenAI } from '../toolWire'
import { executeTool } from '../toolExecutor'
import { useProviderStore } from '../../stores/provider'
import type { TranscriptEntry } from '../transcript'

const ALL = TOOLS.map((t) => t.name)
const user = (content: string): TranscriptEntry => ({ role: 'user', content })

function schemaTokens(names: string[]): number {
  const set = new Set(names)
  const chars = TOOLS.filter((t) => set.has(t.name)).reduce(
    (n, t) => n + JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length,
    0
  )
  return Math.round(chars / 3.6)
}

beforeEach(() => __resetToolsetsForTests())

describe('groupOfTool', () => {
  it('maps prefixed tools to groups and keeps core tools ungrouped', () => {
    expect(groupOfTool('browser_click')?.id).toBe('browser')
    expect(groupOfTool('github_get_pull')?.id).toBe('github')
    expect(groupOfTool('read_file')).toBeNull()
    expect(groupOfTool('load_tools')).toBeNull()
    // Plan ↔ Build switching stays core.
    expect(groupOfTool('app_set_agent_mode')).toBeNull()
    expect(groupOfTool('app_set_model')?.id).toBe('app')
  })
})

describe('activeToolGroups', () => {
  it('activates groups from prior tool calls, load_tools, and user wording', () => {
    const entries: TranscriptEntry[] = [
      user('fix the failing typecheck'),
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'computer_screenshot', arguments: {} }] },
      { role: 'tool', toolCallId: '1', name: 'computer_screenshot', content: 'ok' },
      { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'load_tools', arguments: { groups: ['gitlab'] } }] },
      user('now open https://localhost:3000 and check the login page')
    ]
    expect([...activeToolGroups(entries)].sort()).toEqual(['browser', 'computer', 'gitlab'])
  })

  it('reads tool names from compaction summaries', () => {
    const groups = activeToolGroups([{ role: 'summary', content: 'Tools used: browser_click×3, read_file×2' }])
    expect(groups.has('browser')).toBe(true)
  })

  it('detects Korean phrasing', () => {
    expect(activeToolGroups([user('브라우저로 사이트 열어서 확인해줘')]).has('browser')).toBe(true)
    expect(activeToolGroups([user('지메일에서 받은 메일 요약해줘')]).has('google')).toBe(true)
  })

  it('keeps a plain coding task on core tools only', () => {
    expect(activeToolGroups([user('fix the router module and add unit tests for onClick handlers')]).size).toBe(0)
  })

  it('loads refactoring and long-task tools only when the task calls for them', () => {
    expect(Array.from(activeToolGroups([user('refactor the router module')]))).toEqual(['refactor'])
    expect(activeToolGroups([user('이 함수 호출하는 곳 전부 찾아줘')]).has('refactor')).toBe(true)
    expect(activeToolGroups([user('migrate the whole codebase to ESM')]).has('workspace')).toBe(true)
    expect(groupOfTool('lsp_code_actions')?.id).toBe('refactor')
    expect(groupOfTool('lsp_rename')).toBeNull()
    expect(groupOfTool('working_notes')?.id).toBe('workspace')
    expect(groupOfTool('read_output')).toBeNull()
    // Compaction / clearing already rebuild the prompt cache: long-task tools join for free.
    expect(activeToolGroups([user('fix it'), { role: 'summary', content: 'earlier…' }]).has('workspace')).toBe(true)
    expect(
      activeToolGroups([
        user('fix it'),
        { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'read_file', arguments: {} }] },
        { role: 'tool', toolCallId: 't', name: 'read_file', content: '[cleared to save context: read_file a.ts returned 9,000 chars]' }
      ]).has('workspace')
    ).toBe(true)
  })
})

describe('hiddenToolNames', () => {
  it('hides every optional group for a plain coding session and roughly halves tool tokens', () => {
    const hidden = hiddenToolNames({ entries: [user('rename getUserName')], allToolNames: ALL, connected: new Set() })
    const visible = ALL.filter((n) => !hidden.includes(n))
    expect(visible).toContain('read_file')
    expect(visible).toContain('load_tools')
    expect(visible).toContain('app_set_agent_mode')
    expect(visible.some((n) => n.startsWith('browser_') || n.startsWith('github_') || n.startsWith('computer_'))).toBe(false)
    expect(schemaTokens(visible)).toBeLessThan(schemaTokens(ALL) * 0.6)
  })

  it('keeps account groups hidden while disconnected, even when mentioned', () => {
    const entries = [user('list my open GitHub pull requests')]
    expect(hiddenToolNames({ entries, allToolNames: ALL, connected: new Set() })).toContain('github_list_pulls')
    expect(hiddenToolNames({ entries, allToolNames: ALL, connected: new Set(['github']) })).not.toContain(
      'github_list_pulls'
    )
  })

  it('fails open when the connection status is unknown', () => {
    const entries = [user('list my open GitHub pull requests')]
    expect(hiddenToolNames({ entries, allToolNames: ALL, connected: null })).not.toContain('github_list_pulls')
  })

  it('hides nothing in "all" mode', () => {
    expect(hiddenToolNames({ entries: [], allToolNames: ALL, connected: new Set(), mode: 'all' })).toEqual([])
  })

  it('never hides MCP tools', () => {
    expect(hiddenToolNames({ entries: [], allToolNames: ['mcp__x__y'], connected: new Set() })).toEqual([])
  })

  it('integrates with the wire tool list via the denylist', () => {
    const hidden = hiddenToolNames({ entries: [user('hi')], allToolNames: ALL, connected: new Set() })
    const wire = toolsToOpenAI([], { mode: 'build', denylist: hidden }) as Array<{ function: { name: string } }>
    const names = wire.map((t) => t.function.name)
    expect(names).toContain('edit_file')
    expect(names).not.toContain('browser_navigate')
  })
})

describe('connections cache', () => {
  it('refreshes from window.api.connections.list and caches', async () => {
    const list = vi.fn().mockResolvedValue([
      { provider: 'github', connected: true },
      { provider: 'google', connected: false }
    ])
    ;(window as any).api = { connections: { list } }
    const set = await refreshConnectedProviders()
    expect([...(set || [])]).toEqual(['github'])
    await refreshConnectedProviders()
    expect(list).toHaveBeenCalledTimes(1)
    expect(isGroupAvailable('github', set)).toBe(true)
    expect(isGroupAvailable('google', set)).toBe(false)
    expect(isGroupAvailable('browser', set)).toBe(true)
  })

  it('parses group args from arrays and strings', () => {
    expect(parseToolGroupArgs(['browser', 'nope', 'browser'])).toEqual(['browser'])
    expect(parseToolGroupArgs('github, google')).toEqual(['github', 'google'])
  })
})

describe('load_tools tool', () => {
  beforeEach(() => {
    useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
    ;(window as any).api = { connections: { list: vi.fn().mockResolvedValue([]) }, hooks: undefined }
    setConnectedProviders([])
  })

  it('lists the loaded tools, and refuses disconnected account groups', async () => {
    const r = await executeTool({ id: 'c1', name: 'load_tools', arguments: { groups: ['browser', 'github'] } })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('browser_navigate')
    expect(r.content).toContain('github: account not connected')
  })

  it('errors on unknown groups', async () => {
    const r = await executeTool({ id: 'c2', name: 'load_tools', arguments: { groups: ['bogus'] } })
    expect(r.isError).toBe(true)
  })
})
