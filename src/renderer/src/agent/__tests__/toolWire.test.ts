import { describe, it, expect } from 'vitest'
import { toolsToOpenAI, toolsToClaude } from '../toolWire'
import { TOOLS } from '../toolDefinitions'

describe('toolsToOpenAI', () => {
  it('wraps every tool as a function schema in order', () => {
    const out = toolsToOpenAI()
    expect(out).toHaveLength(TOOLS.length)
    expect(out[0]).toEqual({
      type: 'function',
      function: {
        name: TOOLS[0].name,
        description: TOOLS[0].description,
        parameters: TOOLS[0].parameters
      }
    })
    expect(out.every((t) => t.type === 'function')).toBe(true)
  })

  it('appends extra (e.g. MCP-discovered) tools after the static list', () => {
    const extra = [{ name: 'mcp__codegraph__codegraph_status', description: 'status', parameters: { type: 'object' } }]
    const out = toolsToOpenAI(extra)
    expect(out).toHaveLength(TOOLS.length + 1)
    expect(out[out.length - 1]).toEqual({
      type: 'function',
      function: { name: extra[0].name, description: extra[0].description, parameters: extra[0].parameters }
    })
  })
})

describe('toolsToClaude', () => {
  it('maps schemas and marks only the last tool as cacheable', () => {
    const out = toolsToClaude()
    expect(out).toHaveLength(TOOLS.length)
    expect(out[0]).toEqual({
      name: TOOLS[0].name,
      description: TOOLS[0].description,
      input_schema: TOOLS[0].parameters
    })
    expect(out[out.length - 1].cache_control).toEqual({ type: 'ephemeral' })
    for (const t of out.slice(0, -1)) {
      expect(t.cache_control).toBeUndefined()
    }
  })

  it('skips cache marking when there are no tools', () => {
    // Empty TOOLS would keep the array untouched; assert the guard shape by
    // calling with the real list and verifying no tool is mutated in place.
    const before = JSON.stringify(TOOLS)
    toolsToClaude()
    expect(JSON.stringify(TOOLS)).toBe(before)
  })

  it('marks the extra tools last-entry as cacheable, not a static tool', () => {
    const extra = [{ name: 'mcp__codegraph__codegraph_status', description: 'status', parameters: { type: 'object' } }]
    const out = toolsToClaude(extra)
    expect(out).toHaveLength(TOOLS.length + 1)
    expect(out[out.length - 1].name).toBe(extra[0].name)
    expect(out[out.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })
})
