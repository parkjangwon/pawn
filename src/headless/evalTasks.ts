/**
 * Built-in evaluation tasks: tiny self-contained repos with a prompt and an
 * objective check (plain Node + node:test, no installs, no network).
 */

export interface EvalCheckContext {
  dir: string
  finalText: string
  run: (command: string, timeoutMs?: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  read: (rel: string) => Promise<string | null>
}

export interface EvalTask {
  id: string
  title: string
  tags: string[]
  files: Record<string, string>
  prompt: string
  check: (ctx: EvalCheckContext) => Promise<{ pass: boolean; detail?: string }>
  timeoutMs?: number
}

const PKG = JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2)

/** Pass when `node --test` exits 0 (plus optional extra conditions). */
async function testsPass(ctx: EvalCheckContext): Promise<{ pass: boolean; detail?: string }> {
  const r = await ctx.run('node --test', 60_000)
  if (r.exitCode === 0) return { pass: true }
  const tail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-12).join('\n')
  return { pass: false, detail: `node --test exited ${r.exitCode}\n${tail}` }
}

export const BUILTIN_TASKS: EvalTask[] = [
  {
    id: 'fix-off-by-one',
    title: 'Fix an off-by-one bug reported by a failing test',
    tags: ['bugfix', 'small'],
    files: {
      'package.json': PKG,
      'src/stats.js':
        'export function sum(values) {\n  let total = 0\n  for (let i = 0; i < values.length - 1; i++) total += values[i]\n  return total\n}\n\nexport function mean(values) {\n  return values.length ? sum(values) / values.length : 0\n}\n',
      'test/stats.test.js':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { sum, mean } from '../src/stats.js'\n\ntest('sum', () => assert.equal(sum([1, 2, 3]), 6))\ntest('mean', () => assert.equal(mean([2, 4]), 3))\ntest('empty', () => assert.equal(mean([]), 0))\n"
    },
    prompt: 'The tests in this repo fail (run `npm test`). Find the bug and fix it. Do not modify the tests.',
    check: async (ctx) => {
      const tests = await ctx.read('test/stats.test.js')
      if (!tests?.includes("assert.equal(sum([1, 2, 3]), 6)")) return { pass: false, detail: 'tests were modified' }
      return testsPass(ctx)
    }
  },
  {
    id: 'implement-slugify',
    title: 'Implement a function from a spec with existing tests',
    tags: ['feature', 'small'],
    files: {
      'package.json': PKG,
      'src/slug.js': "/**\n * Convert a title to a URL slug.\n * TODO: implement — see test/slug.test.js\n */\nexport function slugify(title) {\n  throw new Error('not implemented')\n}\n",
      'test/slug.test.js':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { slugify } from '../src/slug.js'\n\ntest('basic', () => assert.equal(slugify('Hello World'), 'hello-world'))\ntest('punctuation', () => assert.equal(slugify('  Rock & Roll!  '), 'rock-roll'))\ntest('accents', () => assert.equal(slugify('Crème Brûlée'), 'creme-brulee'))\ntest('dashes collapse', () => assert.equal(slugify('a -- b'), 'a-b'))\ntest('empty', () => assert.equal(slugify('!!!'), ''))\n"
    },
    prompt: 'Implement `slugify` in src/slug.js so that all tests in test/slug.test.js pass.',
    check: testsPass
  },
  {
    id: 'rename-symbol',
    title: 'Rename a function across files',
    tags: ['refactor', 'multi-file'],
    files: {
      'package.json': PKG,
      'src/user.js': "export function getUserName(user) {\n  return `${user.first} ${user.last}`.trim()\n}\n",
      'src/greet.js': "import { getUserName } from './user.js'\n\nexport function greet(user) {\n  return `Hello, ${getUserName(user)}!`\n}\n",
      'src/report.js': "import { getUserName } from './user.js'\n\nexport function report(users) {\n  return users.map(getUserName).join(', ')\n}\n",
      'test/user.test.js':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport * as user from '../src/user.js'\nimport { greet } from '../src/greet.js'\nimport { report } from '../src/report.js'\n\nconst u = { first: 'Ada', last: 'Lovelace' }\ntest('renamed export', () => assert.equal(typeof user.getUsername, 'function'))\ntest('old name gone', () => assert.equal(user.getUserName, undefined))\ntest('greet', () => assert.equal(greet(u), 'Hello, Ada Lovelace!'))\ntest('report', () => assert.equal(report([u, { first: 'Alan', last: 'Turing' }]), 'Ada Lovelace, Alan Turing'))\n"
    },
    prompt: 'Rename the function `getUserName` to `getUsername` everywhere in src/. Keep behavior identical.',
    check: async (ctx) => {
      for (const f of ['src/user.js', 'src/greet.js', 'src/report.js']) {
        if ((await ctx.read(f))?.includes('getUserName')) return { pass: false, detail: `${f} still references getUserName` }
      }
      return testsPass(ctx)
    }
  },
  {
    id: 'add-cli-flag',
    title: 'Add a feature spanning two modules',
    tags: ['feature', 'multi-file'],
    files: {
      'package.json': PKG,
      'src/format.js': "export function formatTable(rows) {\n  return rows.map((r) => `${r.name}\\t${r.count}`).join('\\n')\n}\n",
      'src/cli.js':
        "import { formatTable } from './format.js'\n\nconst rows = [\n  { name: 'alpha', count: 3 },\n  { name: 'beta', count: 1 }\n]\n\nexport function main(argv) {\n  return formatTable(rows)\n}\n\nif (process.argv[1] && process.argv[1].endsWith('cli.js')) {\n  console.log(main(process.argv.slice(2)))\n}\n",
      'test/cli.test.js':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { main } from '../src/cli.js'\n\ntest('table output unchanged', () => assert.equal(main([]), 'alpha\\t3\\nbeta\\t1'))\n"
    },
    prompt:
      'Add a `--json` flag to src/cli.js: `main(["--json"])` must return the rows as pretty JSON (2-space indent). ' +
      'Put the JSON formatting in src/format.js as `formatJson(rows)`, and add a test for the flag in test/cli.test.js.',
    check: async (ctx) => {
      const r = await ctx.run(
        "node -e \"import('./src/cli.js').then(m=>{const out=m.main(['--json']);const v=JSON.parse(out);if(v.length!==2||v[0].name!=='alpha'||!out.includes('\\n  '))process.exit(3)})\"",
        30_000
      )
      if (r.exitCode !== 0) return { pass: false, detail: `--json output wrong (exit ${r.exitCode}) ${r.stderr.slice(0, 300)}` }
      const fmt = await ctx.read('src/format.js')
      if (!fmt?.includes('formatJson')) return { pass: false, detail: 'formatJson not in src/format.js' }
      const tests = await ctx.read('test/cli.test.js')
      if (!tests?.includes('--json')) return { pass: false, detail: 'no test for --json' }
      return testsPass(ctx)
    }
  },
  {
    id: 'explain-code',
    title: 'Answer a question about the code without editing',
    tags: ['qa', 'read-only'],
    files: {
      'package.json': PKG,
      'src/cache.js':
        "const store = new Map()\n\nexport function remember(key, value, ttlMs) {\n  store.set(key, { value, expires: Date.now() + ttlMs })\n}\n\nexport function recall(key) {\n  const hit = store.get(key)\n  if (!hit) return undefined\n  if (hit.expires < Date.now()) {\n    store.delete(key)\n    return undefined\n  }\n  return hit.value\n}\n"
    },
    prompt: 'In src/cache.js, which function removes expired entries, and when does it do it? Answer in one or two sentences. Do not change any files.',
    check: async (ctx) => {
      const unchanged = (await ctx.read('src/cache.js'))?.includes('store.delete(key)')
      if (!unchanged) return { pass: false, detail: 'file was modified' }
      const t = ctx.finalText.toLowerCase()
      const ok = t.includes('recall') && /(expir|read|access|look|get|call)/.test(t)
      return ok ? { pass: true } : { pass: false, detail: `answer did not name recall(): ${ctx.finalText.slice(0, 200)}` }
    }
  },
  {
    id: 'fix-async-bug',
    title: 'Fix an unawaited async call',
    tags: ['bugfix', 'async'],
    files: {
      'package.json': PKG,
      'src/loader.js':
        "async function fetchItem(id) {\n  await new Promise((r) => setTimeout(r, 5))\n  return { id, name: `item-${id}` }\n}\n\nexport async function loadAll(ids) {\n  const out = []\n  ids.forEach(async (id) => {\n    out.push(await fetchItem(id))\n  })\n  return out\n}\n",
      'test/loader.test.js':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { loadAll } from '../src/loader.js'\n\ntest('loads every item in order', async () => {\n  const items = await loadAll([1, 2, 3])\n  assert.deepEqual(items.map((i) => i.id), [1, 2, 3])\n})\n"
    },
    prompt: '`loadAll` in src/loader.js sometimes returns an empty array. Fix it so the test passes, keeping results in input order.',
    check: testsPass
  }
]

export function selectTasks(ids?: string[]): EvalTask[] {
  if (!ids?.length) return BUILTIN_TASKS
  const want = new Set(ids)
  const found = BUILTIN_TASKS.filter((t) => want.has(t.id) || t.tags.some((tag) => want.has(tag)))
  return found
}
