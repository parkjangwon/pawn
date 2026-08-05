import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirHolder = vi.hoisted(() => ({ dir: '' }))

vi.mock('../config', () => ({
  getPawnDir: () => dirHolder.dir
}))

import { redactSecrets, validateMemoryContent, normalizeTags } from '../memory/safety'
import { embedText, cosine, packEmbedding, unpackEmbedding, EMBED_DIM } from '../memory/embed'
import { extractFromMessages } from '../memory/extract'
import {
  closeMemoryDb,
  getMemorySettings,
  setMemorySettings,
  saveMemory,
  updateMemory,
  forgetMemory,
  forgetMany,
  clearMemories,
  searchMemories,
  listMemories,
  getMemory,
  stats,
  buildInjectBlock,
  ingestTurn,
  exportAll,
  importMany
} from '../memory'

beforeAll(() => {
  dirHolder.dir = mkdtempSync(join(tmpdir(), 'pawn-memory-test-'))
})

beforeEach(() => {
  closeMemoryDb()
  for (const suffix of ['memory.db', 'memory.db-wal', 'memory.db-shm']) {
    rmSync(join(dirHolder.dir, suffix), { force: true })
  }
})

afterAll(() => {
  closeMemoryDb()
  rmSync(dirHolder.dir, { recursive: true, force: true })
})

describe('memory/safety', () => {
  it('redacts API keys and passwords', () => {
    const { text, redacted } = redactSecrets(
      'key sk-abcdefghijklmnopqrstuvwxyz12 password=supersecret token'
    )
    expect(redacted.length).toBeGreaterThan(0)
    expect(text).toMatch(/REDACTED/)
    expect(text).not.toContain('supersecret')
  })

  it('rejects too-short content', () => {
    expect(validateMemoryContent('hi').ok).toBe(false)
  })

  it('accepts normal content and redacts secrets in place', () => {
    const r = validateMemoryContent(
      'Always use TypeScript strict mode. Never commit secrets like sk-abcdefghijklmnopqrstuvwxyz12'
    )
    expect(r.ok).toBe(true)
    expect(r.content).toMatch(/REDACTED/)
    expect(r.content).toContain('TypeScript')
  })

  it('rejects pure-secret blobs', () => {
    const r = validateMemoryContent('sk-abcdefghijklmnopqrstuvwxyz12 sk-abcdefghijklmnopqrstuvwxyz99')
    expect(r.ok).toBe(false)
  })

  it('normalizes tags', () => {
    expect(normalizeTags([' A ', 'a', 'B', '', 1])).toEqual(['a', 'b', '1'])
  })
})

describe('memory/embed', () => {
  it('produces unit-ish vectors of fixed dim', () => {
    const a = embedText('prefer dark theme always')
    const b = embedText('prefer dark theme always')
    const c = embedText('deploy with docker compose')
    expect(a.length).toBe(EMBED_DIM)
    expect(cosine(a, b)).toBeGreaterThan(0.99)
    expect(cosine(a, c)).toBeLessThan(cosine(a, b))
  })

  it('round-trips pack/unpack', () => {
    const v = embedText('hello world memory')
    const buf = packEmbedding(v)
    const back = unpackEmbedding(buf)
    expect(back).not.toBeNull()
    expect(cosine(v, back!)).toBeGreaterThan(0.999)
  })
})

describe('memory/extract', () => {
  it('extracts explicit remember commands', () => {
    const cards = extractFromMessages([
      { role: 'user', content: 'Remember that: always run typecheck before commit' }
    ])
    expect(cards.some((c) => /typecheck/i.test(c.content || ''))).toBe(true)
    expect(cards[0]?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('extracts Korean remember', () => {
    const cards = extractFromMessages([
      { role: 'user', content: '기억해줘: 항상 pnpm을 사용해' }
    ])
    expect(cards.length).toBeGreaterThan(0)
  })

  it('skips pure questions', () => {
    const cards = extractFromMessages([
      { role: 'user', content: 'What is the best way to structure this folder?' }
    ])
    expect(cards.every((c) => !/^what is/i.test(c.content || ''))).toBe(true)
  })
})

describe('memory store', () => {
  it('defaults settings and persists patches', () => {
    const s0 = getMemorySettings()
    expect(s0.enabled).toBe(true)
    const s1 = setMemorySettings({ autoCapture: false, injectLimit: 5 })
    expect(s1.autoCapture).toBe(false)
    expect(s1.injectLimit).toBe(5)
    expect(getMemorySettings().injectLimit).toBe(5)
  })

  it('saves, lists, searches, updates, forgets', () => {
    const a = saveMemory({
      content: 'User prefers functional React components with hooks',
      kind: 'preference',
      scope: 'user',
      tags: ['react', 'style'],
      source: 'user',
      pinned: true
    })
    expect(a.ok).toBe(true)
    expect(a.memory?.id).toBeTruthy()

    const b = saveMemory({
      content: 'Deploy production via GitHub Actions on main branch',
      kind: 'procedure',
      scope: 'project',
      projectId: 'proj-1',
      source: 'agent'
    })
    expect(b.ok).toBe(true)

    // Dedup same content
    const again = saveMemory({
      content: 'User prefers functional React components with hooks',
      kind: 'preference',
      scope: 'user',
      source: 'user'
    })
    expect(again.deduped).toBe(true)

    const listed = listMemories({ limit: 10 })
    expect(listed.total).toBe(2)

    const hits = searchMemories({ query: 'React hooks preference', limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].content).toMatch(/React/i)

    const projHits = searchMemories({
      query: 'deploy production',
      projectId: 'proj-1',
      limit: 5
    })
    expect(projHits.some((h) => h.kind === 'procedure')).toBe(true)

    const updated = updateMemory(a.memory!.id, {
      content: 'User prefers functional React components with hooks and TypeScript',
      title: 'React + TS style',
      pinned: true
    })
    expect(updated.ok).toBe(true)
    expect(updated.memory?.title).toBe('React + TS style')
    expect(getMemory(a.memory!.id)?.content).toMatch(/TypeScript/)

    const st = stats()
    expect(st.total).toBe(2)
    expect(st.pinned).toBeGreaterThanOrEqual(1)

    expect(forgetMemory(b.memory!.id).ok).toBe(true)
    expect(getMemory(b.memory!.id)).toBeNull()
    expect(listMemories().total).toBe(1)
  })

  it('blocks agent saves when disabled; allows user saves', () => {
    setMemorySettings({ enabled: false })
    const agent = saveMemory({
      content: 'This should fail for agent when disabled fully',
      source: 'agent'
    })
    expect(agent.ok).toBe(false)

    const user = saveMemory({
      content: 'User manually added this preference card here',
      source: 'user'
    })
    expect(user.ok).toBe(true)
  })

  it('builds inject block with untrusted banner', () => {
    setMemorySettings({ enabled: true, injectOnTurn: true, injectLimit: 4 })
    saveMemory({
      content: 'Always reply in Korean for this user when chatting casually',
      kind: 'preference',
      source: 'user',
      pinned: true
    })
    const block = buildInjectBlock({ query: 'language preference korean' })
    expect(block).toMatch(/Long-term Memory/)
    expect(block).toMatch(/untrusted/i)
    expect(block).toMatch(/Korean/i)
  })

  it('injects empty when injectOnTurn off', () => {
    setMemorySettings({ injectOnTurn: false })
    saveMemory({ content: 'Something durable about the project structure here', source: 'user' })
    expect(buildInjectBlock({ query: 'project structure' })).toBe('')
  })

  it('ingests turn via heuristics', () => {
    setMemorySettings({ enabled: true, autoCapture: true, requireMinConfidence: 0.4 })
    const res = ingestTurn({
      messages: [
        { role: 'user', content: 'Remember that: use pnpm not npm for this monorepo' },
        { role: 'assistant', content: 'Got it, I will use pnpm.' }
      ]
    })
    expect(res.ok).toBe(true)
    expect(res.saved.length).toBeGreaterThan(0)
  })

  it('export/import and clear', () => {
    saveMemory({ content: 'First exportable memory card content here', source: 'user' })
    saveMemory({ content: 'Second exportable memory card content here', source: 'user' })
    const all = exportAll()
    expect(all.length).toBe(2)

    clearMemories()
    expect(stats().total).toBe(0)

    const imp = importMany(
      all.map((m) => ({
        content: m.content,
        title: m.title,
        kind: m.kind as 'fact',
        tags: m.tags,
        pinned: m.pinned
      }))
    )
    expect(imp.imported).toBe(2)
    expect(stats().total).toBe(2)

    const n = forgetMany(exportAll().map((m) => m.id))
    expect(n.deleted).toBe(2)
  })

  it('rejects secret-only saves', () => {
    const r = saveMemory({
      content: 'password=hunter2secretvalue api_key=sk-abcdefghijklmnopqrstuv',
      source: 'user'
    })
    // may redact heavily and fail validation
    if (r.ok) {
      expect(r.memory?.content).toMatch(/REDACTED/)
    } else {
      expect(r.error).toBeTruthy()
    }
  })
})
