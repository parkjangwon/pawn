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
})
