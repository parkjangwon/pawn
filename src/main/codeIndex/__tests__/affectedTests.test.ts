import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { findAffectedTests, formatAffectedTests, isTestFile } from '../affectedTests'
import { buildImportGraph } from '../importGraph'

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}
async function w(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

describe('isTestFile', () => {
  it('detects test files across languages', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true)
    expect(isTestFile('src/__tests__/a.ts')).toBe(true)
    expect(isTestFile('pkg/test_mod.py')).toBe(true)
    expect(isTestFile('pkg/mod_test.py')).toBe(true)
    expect(isTestFile('pkg/foo_test.go')).toBe(true)
    expect(isTestFile('src/a.ts')).toBe(false)
  })
})

describe('TS/JS affected tests', () => {
  it('resolves direct, transitive, alias, and .js->.ts imports, plus name-match', async () => {
    const repo = await mkTmp('pawn-at-ts-')
    try {
      await w(repo, 'package.json', JSON.stringify({
        name: 'fix', devDependencies: { vitest: '^1.0.0' }
      }))
      await w(repo, 'tsconfig.json', [
        '{',
        '  // config with alias',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": { "@/*": ["src/*"] },', // trailing comma tolerated
        '  }',
        '}'
      ].join('\n'))
      await w(repo, 'src/core.ts', 'export const core = 1\n')
      await w(repo, 'src/mid.ts', "import { core } from './core'\nexport const mid = core + 1\n")
      // direct import (with .js ESM rewrite)
      await w(repo, 'src/mid.test.ts', "import { mid } from './mid.js'\nimport { it } from 'vitest'\nit('x', () => {})\n")
      // transitive test importing mid via top
      await w(repo, 'src/top.ts', "import { mid } from './mid'\nexport const top = mid\n")
      await w(repo, 'src/top.test.ts', "import { top } from './top'\nimport { it } from 'vitest'\nit('y', () => {})\n")
      // alias import test
      await w(repo, 'src/alias.test.ts', "import { core } from '@/core'\nimport { it } from 'vitest'\nit('z', () => {})\n")
      // name-match: foo.ts <-> foo.test.ts
      await w(repo, 'src/foo.ts', 'export const foo = 1\n')
      await w(repo, 'src/foo.test.ts', "import { it } from 'vitest'\nit('foo', () => {})\n")

      const res = await findAffectedTests(repo, ['src/core.ts'])
      const paths = res.tests.map((t) => t.path).sort()
      expect(paths).toContain('src/mid.test.ts') // via mid (depth 2) or transitive
      expect(paths).toContain('src/top.test.ts') // transitive depth 3
      expect(paths).toContain('src/alias.test.ts') // alias import

      // depth ordering
      const mid = res.tests.find((t) => t.path === 'src/mid.test.ts')!
      const top = res.tests.find((t) => t.path === 'src/top.test.ts')!
      expect((mid.depth ?? 0)).toBeLessThanOrEqual(top.depth ?? 0)

      // name-match on a distinct changed file
      const res2 = await findAffectedTests(repo, ['src/foo.ts'])
      const foo = res2.tests.find((t) => t.path === 'src/foo.test.ts')!
      expect(foo).toBeTruthy()
      expect(['name-match', 'imports']).toContain(foo.reason)

      // vitest command
      expect(res.commands.some((c) => c.runner === 'vitest' && c.command.startsWith('npx vitest run'))).toBe(true)

      // changed test file itself is included
      const res3 = await findAffectedTests(repo, ['src/mid.test.ts'])
      expect(res3.tests.some((t) => t.path === 'src/mid.test.ts' && t.reason === 'is-test')).toBe(true)

      expect(formatAffectedTests(res)).toContain('Affected tests:')
    } finally {
      await fs.rm(repo, { recursive: true, force: true })
    }
  })
})

describe('Python affected tests', () => {
  it('resolves absolute and relative imports', async () => {
    const repo = await mkTmp('pawn-at-py-')
    try {
      await w(repo, 'pyproject.toml', '[tool.pytest.ini_options]\n')
      await w(repo, 'pkg/__init__.py', '')
      await w(repo, 'pkg/core.py', 'VALUE = 1\n')
      await w(repo, 'pkg/use.py', 'from .core import VALUE\n')
      await w(repo, 'pkg/test_core.py', 'from pkg.core import VALUE\ndef test_v():\n    assert VALUE == 1\n')
      await w(repo, 'tests/test_use.py', 'from pkg.use import VALUE\ndef test_u():\n    pass\n')

      const res = await findAffectedTests(repo, ['pkg/core.py'])
      const paths = res.tests.map((t) => t.path)
      // test_core imports pkg.core directly; test_use imports pkg.use which imports .core
      expect(paths).toContain('pkg/test_core.py')
      expect(paths).toContain('tests/test_use.py')
      expect(res.commands.some((c) => c.runner === 'pytest' && c.command.includes('python -m pytest'))).toBe(true)
    } finally {
      await fs.rm(repo, { recursive: true, force: true })
    }
  })
})

describe('Go affected tests', () => {
  it('resolves package imports to _test.go files', async () => {
    const repo = await mkTmp('pawn-at-go-')
    try {
      await w(repo, 'go.mod', 'module example.com/app\n\ngo 1.21\n')
      await w(repo, 'pkg/core/core.go', 'package core\n\nfunc Val() int { return 1 }\n')
      await w(repo, 'pkg/core/core_test.go', 'package core\n\nimport "testing"\n\nfunc TestVal(t *testing.T) {}\n')
      await w(repo, 'pkg/user/user.go', 'package user\n\nimport "example.com/app/pkg/core"\n\nfunc U() int { return core.Val() }\n')
      await w(repo, 'pkg/user/user_test.go', 'package user\n\nimport "testing"\n\nfunc TestU(t *testing.T) {}\n')

      const res = await findAffectedTests(repo, ['pkg/core/core.go'])
      const paths = res.tests.map((t) => t.path)
      expect(paths).toContain('pkg/core/core_test.go') // same-dir test (name-match / is-test)
      expect(paths).toContain('pkg/user/user_test.go') // importing package's test
      expect(res.commands.some((c) => c.runner === 'go' && c.command.startsWith('go test'))).toBe(true)
    } finally {
      await fs.rm(repo, { recursive: true, force: true })
    }
  })
})

describe('buildImportGraph', () => {
  it('builds reverse edges', async () => {
    const repo = await mkTmp('pawn-ig-')
    try {
      await w(repo, 'a.ts', 'export const a = 1\n')
      await w(repo, 'b.ts', "import { a } from './a'\nexport const b = a\n")
      const g = await buildImportGraph(repo)
      expect(Array.from(g.reverse.get('a.ts') || [])).toContain('b.ts')
      expect(Array.from(g.forward.get('b.ts') || [])).toContain('a.ts')
    } finally {
      await fs.rm(repo, { recursive: true, force: true })
    }
  })
})
