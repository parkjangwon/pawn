import { describe, it, expect } from 'vitest'
import { parseGitignore, isIgnored } from '../gitignore'

describe('gitignore matcher', () => {
  it('ignores node_modules and build artifacts', () => {
    const rules = parseGitignore('node_modules/\ndist\n*.log\n')
    expect(isIgnored('node_modules', true, rules)).toBe(true)
    expect(isIgnored('node_modules/pkg/index.js', false, rules)).toBe(true)
    expect(isIgnored('dist', true, rules)).toBe(true)
    expect(isIgnored('app.log', false, rules)).toBe(true)
    expect(isIgnored('src/index.ts', false, rules)).toBe(false)
  })

  it('supports negation', () => {
    const rules = parseGitignore('*.env\n!.env.example\n')
    expect(isIgnored('.env', false, rules)).toBe(true)
    expect(isIgnored('.env.example', false, rules)).toBe(false)
  })

  it('supports anchored patterns', () => {
    const rules = parseGitignore('/build\n')
    expect(isIgnored('build', true, rules)).toBe(true)
    expect(isIgnored('pkg/build', true, rules)).toBe(false)
  })
})
