import { describe, it, expect } from 'vitest'
import {
  parseAgentMarkdown,
  profileFromMarkdown,
  resolveProfileName,
  thoroughnessMaxRounds,
  serializeAgentProfile,
  sanitizeAgentName,
  isPawnAgentPath,
  BUILTIN_AGENT_PROFILES,
  getBuiltinProfile
} from '../agentProfiles'
import { isSubagentToolAllowed } from '../subagent'

describe('agentProfiles', () => {
  it('has Claude-like built-ins', () => {
    const names = BUILTIN_AGENT_PROFILES.map((p) => p.name).sort()
    expect(names).toEqual(['code-reviewer', 'explore', 'plan', 'worker'])
  })

  it('explore is read-only; worker cannot spawn', () => {
    const explore = getBuiltinProfile('explore')!
    const worker = getBuiltinProfile('worker')!
    expect(isSubagentToolAllowed('read_file', explore)).toBe(true)
    expect(isSubagentToolAllowed('edit_file', explore)).toBe(false)
    expect(isSubagentToolAllowed('edit_file', worker)).toBe(true)
    expect(isSubagentToolAllowed('spawn_agent', worker)).toBe(false)
  })

  it('parses frontmatter markdown', () => {
    const raw = `---
name: security-audit
description: Finds security issues
tools: Read, Grep, Glob
model: mid
isolation: none
---

You are a security specialist.
`
    const { meta, body } = parseAgentMarkdown(raw, 'fallback')
    expect(meta.name).toBe('security-audit')
    expect(meta.tools).toContain('Read')
    expect(body).toContain('security specialist')
    const p = profileFromMarkdown(raw, 'fallback', 'project', '/x.md')
    expect(p?.name).toBe('security-audit')
    expect(p?.tools).toEqual(['read_file', 'grep_search', 'search_files'])
    expect(p?.model).toBe('mid')
  })

  it('maps legacy mode to profile names', () => {
    expect(resolveProfileName(undefined, 'worker')).toBe('worker')
    expect(resolveProfileName('code-reviewer', 'explore')).toBe('code-reviewer')
    expect(resolveProfileName(undefined, undefined)).toBe('explore')
  })

  it('scales rounds by thoroughness', () => {
    expect(thoroughnessMaxRounds(12, 'quick')).toBe(6)
    expect(thoroughnessMaxRounds(12, 'very_thorough')).toBe(20)
    expect(thoroughnessMaxRounds(12, 'medium')).toBe(12)
  })

  it('serializes and re-parses agent markdown', () => {
    const md = serializeAgentProfile({
      name: 'Security Audit!',
      description: 'Finds security issues',
      systemPrompt: 'You are a security specialist.\nBe thorough.',
      tools: ['read_file', 'grep_search'],
      model: 'mid',
      maxTurns: 10,
      isolation: 'none',
      apply: 'none',
      thoroughness: 'medium'
    })
    expect(sanitizeAgentName('Security Audit!')).toBe('security-audit')
    const p = profileFromMarkdown(md, 'fallback', 'project', '/proj/.pawn/agents/security-audit.md')
    expect(p?.name).toBe('security-audit')
    expect(p?.description).toContain('security')
    expect(p?.tools).toEqual(['read_file', 'grep_search'])
    expect(p?.model).toBe('mid')
    expect(p?.systemPrompt).toContain('security specialist')
    expect(isPawnAgentPath('/proj/.pawn/agents/security-audit.md')).toBe(true)
    expect(isPawnAgentPath('/proj/.claude/agents/x.md')).toBe(false)
  })
})
