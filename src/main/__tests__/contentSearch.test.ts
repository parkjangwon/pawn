import { describe, it, expect, beforeEach } from 'vitest'
import {
  contentSearch,
  formatContentMatches,
  resetRgCache,
  resolveRgBin
} from '../contentSearch'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

describe('contentSearch', () => {
  beforeEach(() => {
    resetRgCache()
  })

  it('rejects empty query', async () => {
    const r = await contentSearch('/tmp', { query: '  ' })
    expect(r.error).toMatch(/query/i)
    expect(r.matches).toEqual([])
  })

  it('finds a symbol via rg or git-grep when available', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pawn-csearch-'))
    try {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'hello.ts'), 'export function findMeFast() {\n  return 1\n}\n')
      // Prefer git so git-grep works even without rg
      try {
        execSync('git init', { cwd: dir, stdio: 'ignore' })
        execSync('git add -A', { cwd: dir, stdio: 'ignore' })
        execSync('git -c user.email=t@t -c user.name=t commit -m init', {
          cwd: dir,
          stdio: 'ignore'
        })
      } catch {
        // no git — rely on rg only
      }

      const r = await contentSearch(dir, { query: 'findMeFast', fixedString: true, maxMatches: 20 })
      // If neither engine exists, engine=none is acceptable on bare CI.
      if (r.engine === 'none') {
        expect(resolveRgBin()).toBeNull()
        return
      }
      expect(r.matches.some((m) => m.text.includes('findMeFast'))).toBe(true)
      const text = formatContentMatches(r, dir, 'findMeFast')
      expect(text).toContain('findMeFast')
      expect(text).toMatch(/engine=/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
