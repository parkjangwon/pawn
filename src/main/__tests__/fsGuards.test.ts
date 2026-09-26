import { describe, it, expect } from 'vitest'
import { isProtectedRemovePath, isSecretDotFile } from '../fsGuards'

describe('fsGuards', () => {
  it('flags secret dotfiles but not templates', () => {
    for (const n of ['.env', '.env.local', '.env.production', '.npmrc', '.netrc', '.pypirc']) {
      expect(isSecretDotFile(n), n).toBe(true)
    }
    for (const n of ['.env.example', '.env.sample', '.env.template', '.gitignore', 'env.ts']) {
      expect(isSecretDotFile(n), n).toBe(false)
    }
  })

  it('refuses roots, system dirs, home and its ancestors', () => {
    const home = '/Users/alice'
    for (const p of ['/', '/etc', '/usr', '/Users', '/Users/alice', '/Users/alice/']) {
      expect(isProtectedRemovePath(p, home), p).toBe(true)
    }
  })

  it('allows ordinary directories inside home', () => {
    const home = '/Users/alice'
    expect(isProtectedRemovePath('/Users/alice/dev/proj/node_modules', home)).toBe(false)
    expect(isProtectedRemovePath('/tmp/scratch', home)).toBe(false)
  })
})
