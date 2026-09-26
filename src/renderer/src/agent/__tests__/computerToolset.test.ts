// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  COMPUTER_HALT_TEXT,
  NATIVE_DUPLICATES,
  claudeComputerVersion,
  claudeModelVersion,
  endsWithObservation,
  isComputerCall,
  nativeCallToAction,
  permissionName,
  planNativeComputer
} from '../computerToolset'
import { claudeToolsWithComputer } from '../llm'
import { toClaudeMessages, toOpenAIMessages, type TranscriptEntry } from '../transcript'
import { toolsToClaude } from '../toolWire'
import { executeTool } from '../toolExecutor'
import { noteComputerModel, shotPolicyFor } from '../toolHandlers/computer'
import { activeToolGroups } from '../toolsets'
import { useProviderStore } from '../../stores/provider'

describe('model → computer tool version', () => {
  it.each([
    ['claude-opus-5-5', 'toolset_20260801'],
    ['claude-opus-5-5-20260915', 'toolset_20260801'],
    ['claude-opus-5', 'computer_20251124'],
    ['claude-sonnet-5', 'computer_20251124'],
    ['claude-fable-5-1', 'computer_20251124'],
    ['claude-opus-4-8', 'computer_20251124'],
    ['claude-opus-4-5-20251101', 'computer_20251124'],
    ['claude-sonnet-4-6', 'computer_20251124'],
    ['claude-sonnet-4-5-20250929', 'computer_20250124'],
    ['claude-haiku-4-5', 'computer_20250124'],
    ['claude-sonnet-4-20250514', 'computer_20250124'],
    ['claude-opus-4-1', 'computer_20250124'],
    ['gpt-5.4', null],
    ['deepseek-v4', null]
  ])('%s → %s', (id, want) => {
    expect(claudeComputerVersion(id)).toBe(want)
  })

  it('ignores dated suffixes when parsing the version', () => {
    expect(claudeModelVersion('claude-sonnet-4-20250514')).toEqual({ family: 'sonnet', version: 4 })
    expect(claudeModelVersion('claude-opus-4-7')).toEqual({ family: 'opus', version: 4.7 })
  })
})

describe('planNativeComputer', () => {
  const base = {
    apiFormat: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    toolNames: ['computer_screenshot', 'computer_click', 'read_file'],
    desktop: true,
    display: { width: 1568, height: 1013 }
  }

  it('declares the toolset for Claude 5.5 without a beta header', () => {
    expect(planNativeComputer({ ...base, modelId: 'claude-opus-5-5' })).toEqual({
      version: 'toolset_20260801',
      entry: { type: 'computer_toolset_20260801' }
    })
  })

  it('declares computer_20251124 with display size, zoom, and the beta header', () => {
    expect(planNativeComputer({ ...base, modelId: 'claude-sonnet-4-6' })).toEqual({
      version: 'computer_20251124',
      entry: { type: 'computer_20251124', name: 'computer', display_width_px: 1568, display_height_px: 1013, enable_zoom: true },
      betaHeader: 'computer-use-2025-11-24'
    })
    expect(planNativeComputer({ ...base, modelId: 'claude-haiku-4-5' })?.betaHeader).toBe('computer-use-2025-01-24')
  })

  it('stays off for gateways, non-desktop, disabled, or when acting is not allowed', () => {
    expect(planNativeComputer({ ...base, modelId: 'claude-opus-5-5', baseUrl: 'https://openrouter.ai/api/v1' })).toBeNull()
    expect(planNativeComputer({ ...base, modelId: 'claude-opus-5-5', desktop: false })).toBeNull()
    expect(planNativeComputer({ ...base, modelId: 'claude-opus-5-5', enabled: false })).toBeNull()
    expect(planNativeComputer({ ...base, modelId: 'claude-opus-5-5', toolNames: ['computer_screenshot'] })).toBeNull()
    expect(planNativeComputer({ ...base, modelId: 'claude-sonnet-4-6', display: undefined })).toBeNull()
    expect(planNativeComputer({ ...base, modelId: 'claude-opus-5-5', apiFormat: 'openai' })).toBeNull()
  })
})

describe('request tools swap', () => {
  beforeEach(() => {
    ;(window as any).api = {
      platform: 'darwin',
      computer: { exec: vi.fn().mockResolvedValue({ ok: true, text: '1568x1013', data: { width: 1568, height: 1013 } }) }
    }
    useProviderStore.setState({ nativeComputerTool: true, agentMode: 'build', sessionAgentModes: {} } as any)
  })

  it('replaces duplicate computer_* tools with the native toolset and keeps the extras', async () => {
    const tools = toolsToClaude([], { mode: 'build' })
    const headers: Record<string, string> = {}
    const out = await claudeToolsWithComputer(tools, { apiFormat: 'claude', baseUrl: 'https://api.anthropic.com' }, 'claude-opus-5-5', headers)
    const names = out.map((t) => String(t.name || t.type))
    for (const dup of NATIVE_DUPLICATES) expect(names).not.toContain(dup)
    expect(names).toContain('computer_ui_snapshot')
    expect(names).toContain('computer_apps')
    expect(out.at(-1)).toEqual({ type: 'computer_toolset_20260801', cache_control: { type: 'ephemeral' } })
    expect(out.filter((t) => t.cache_control)).toHaveLength(1)
    expect(headers['anthropic-beta']).toBeUndefined()
  })

  it('adds display size and the beta header for earlier Claude models', async () => {
    const headers: Record<string, string> = { 'anthropic-beta': 'other-beta' }
    const out = await claudeToolsWithComputer(toolsToClaude([], { mode: 'build' }), { apiFormat: 'claude', baseUrl: 'https://api.anthropic.com' }, 'claude-opus-4-7', headers)
    expect(out.at(-1)).toMatchObject({ type: 'computer_20251124', name: 'computer', display_width_px: 1568, display_height_px: 1013 })
    expect(headers['anthropic-beta']).toBe('other-beta,computer-use-2025-11-24')
    expect((window as any).api.computer.exec).toHaveBeenCalledWith('display_size', {}, shotPolicyFor('claude-opus-4-7'))
  })

  it('leaves the request alone when computer tools are dieted out', async () => {
    const tools = toolsToClaude([], { mode: 'build', denylist: ['computer_screenshot', 'computer_click'] })
    const out = await claudeToolsWithComputer(tools, { apiFormat: 'claude', baseUrl: 'https://api.anthropic.com' }, 'claude-opus-5-5', {})
    expect(out).toBe(tools)
  })
})

describe('wire format', () => {
  const entries: TranscriptEntry[] = [
    { role: 'user', content: 'open Calculator' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'tu_1', name: 'left_click', toolset: 'computer', arguments: { coordinate: [10, 20] } },
        { id: 'tu_2', name: 'screenshot', toolset: 'computer', arguments: {} },
        { id: 'tu_3', name: 'computer_ui_snapshot', arguments: {} }
      ]
    },
    { role: 'tool', toolCallId: 'tu_1', name: 'left_click', content: 'Clicked at (10, 20)' },
    { role: 'tool', toolCallId: 'tu_2', name: 'screenshot', content: 'screenshot 2x2\ndata:image/png;base64,iVBORw0KGgo=' },
    { role: 'tool', toolCallId: 'tu_3', name: 'computer_ui_snapshot', content: '[1] button "7"' }
  ]

  it('echoes toolset_name on toolset tool_use and tool_result blocks only', () => {
    const msgs = toClaudeMessages(entries)
    const uses = msgs[1].content as Array<Record<string, unknown>>
    expect(uses[0]).toEqual({ type: 'tool_use', id: 'tu_1', name: 'left_click', toolset_name: 'computer', input: { coordinate: [10, 20] } })
    expect(uses[2]).not.toHaveProperty('toolset_name')
    const results = msgs[2].content as Array<Record<string, unknown>>
    expect(results[0]).toMatchObject({ tool_use_id: 'tu_1', toolset_name: 'computer', is_error: false })
    expect(results[1].toolset_name).toBe('computer')
    expect((results[1].content as Array<{ type: string }>).map((b) => b.type)).toEqual(['text', 'image'])
    expect(results[2]).not.toHaveProperty('toolset_name')
  })

  it('is byte-stable across serializations (prompt cache)', () => {
    expect(JSON.stringify(toClaudeMessages(entries))).toBe(JSON.stringify(toClaudeMessages(entries)))
  })

  it('maps toolset calls to function-safe names for OpenAI-format models', () => {
    const msgs = toOpenAIMessages(entries)
    const calls = (msgs[1] as { tool_calls: Array<{ function: { name: string } }> }).tool_calls
    expect(calls.map((c) => c.function.name)).toEqual(['computer_left_click', 'computer_screenshot', 'computer_ui_snapshot'])
  })

  it('keeps the computer tool group active after native calls (tool diet)', () => {
    expect(activeToolGroups(entries.slice(0, 2)).has('computer')).toBe(true)
  })
})

describe('call helpers', () => {
  it('maps native calls to engine actions and permission names', () => {
    const toolset = { id: '1', name: 'left_click', toolset: 'computer', arguments: { coordinate: [1, 2] } }
    const legacy = { id: '2', name: 'computer', arguments: { action: 'key', text: 'Return' } }
    expect(nativeCallToAction(toolset)).toEqual({ action: 'left_click', args: { coordinate: [1, 2] } })
    expect(nativeCallToAction(legacy)).toEqual({ action: 'key', args: { text: 'Return' } })
    expect(permissionName(toolset)).toBe('computer_left_click')
    expect(permissionName(legacy)).toBe('computer_key')
    expect(permissionName({ name: 'read_file', arguments: {} })).toBe('read_file')
    expect(isComputerCall(toolset) && isComputerCall(legacy) && isComputerCall({ name: 'computer_apps' } as never)).toBe(true)
  })

  it('knows whether a batch already ends by looking at the screen', () => {
    const c = (name: string, args = {}) => ({ id: name, name, toolset: 'computer', arguments: args })
    expect(endsWithObservation([c('left_click'), c('screenshot')])).toBe(true)
    expect(endsWithObservation([c('left_click'), c('type')])).toBe(false)
    expect(endsWithObservation([{ name: 'computer_click', arguments: { return_screenshot: true } }])).toBe(true)
    expect(COMPUTER_HALT_TEXT).toBe('Not executed: an earlier computer action in this turn failed.')
  })

  it('sizes screenshots for the routed model (matches the declared display)', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true, text: 'ok' })
    ;(window as any).api = { computer: { exec } }
    useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
    noteComputerModel('claude-sonnet-4-5')
    await executeTool({ id: 'a', name: 'screenshot', toolset: 'computer', arguments: {} })
    expect(exec.mock.calls[0][2]).toEqual(shotPolicyFor('claude-sonnet-4-5'))
    noteComputerModel('claude-opus-5-5')
    await executeTool({ id: 'b', name: 'computer_screenshot', arguments: {} })
    expect(exec.mock.calls[1][2]).toEqual(shotPolicyFor('claude-opus-5-5'))
    noteComputerModel(undefined)
  })

  it('picks the high-resolution screenshot tier for newer vision models', () => {
    expect(shotPolicyFor('claude-opus-5-5').maxLongEdge).toBe(1920)
    expect(shotPolicyFor('claude-opus-4-7').maxLongEdge).toBe(1920)
    expect(shotPolicyFor('gpt-5.4').maxLongEdge).toBe(1920)
    expect(shotPolicyFor('claude-sonnet-4-5').maxLongEdge).toBe(1568)
    expect(shotPolicyFor('deepseek-v4').maxLongEdge).toBe(1568)
  })
})

describe('executing native calls', () => {
  beforeEach(() => {
    useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
  })

  it('routes toolset members to the engine with a data-URL image result', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true, text: 'screenshot 2x2', image: { dataUrl: 'data:image/png;base64,AAAA', width: 2, height: 2 } })
    ;(window as any).api = { computer: { exec } }
    const r = await executeTool({ id: 't', name: 'screenshot', toolset: 'computer', arguments: {} })
    expect(exec).toHaveBeenCalledWith('screenshot', {}, expect.objectContaining({ maxLongEdge: expect.any(Number) }))
    expect(r).toEqual({ toolCallId: 't', content: 'screenshot 2x2\ndata:image/png;base64,AAAA', isError: false })
    const legacy = await executeTool({ id: 'u', name: 'computer', arguments: { action: 'left_click', coordinate: [5, 6] } })
    expect(exec).toHaveBeenLastCalledWith('left_click', { coordinate: [5, 6] }, expect.anything())
    expect(legacy.isError).toBe(false)
  })

  it('blocks native computer actions in Plan mode', async () => {
    useProviderStore.setState({ agentMode: 'plan' } as any)
    ;(window as any).api = { computer: { exec: vi.fn() } }
    const r = await executeTool({ id: 't', name: 'left_click', toolset: 'computer', arguments: {} })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('Plan mode')
  })
})
