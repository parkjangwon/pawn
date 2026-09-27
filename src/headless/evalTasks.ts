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
  /** Files of a known-good solution (harness self-test: the check must pass with them). */
  reference?: Record<string, string>
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

// --- Harder tasks: runtime behaviour, noisy output, large repos, stateful bugs,
// semantic refactors. Each has a reference solution the self-test verifies.

const PKG_START = JSON.stringify({ name: 'api', version: '1.0.0', type: 'module', scripts: { start: 'node src/server.js' } }, null, 2)

const SERVER_FILES: Record<string, string> = {
  'package.json': PKG_START,
  'data/items.json': JSON.stringify(
    [
      { name: 'pen', price: 1.5, qty: 2, tags: ['Writing', 'Office'] },
      { name: 'pad', price: 2, qty: 1 },
      { name: 'ink', price: 0.5, qty: 2, tags: ['writing'] }
    ],
    null,
    2
  ) + '\n',
  'src/store.js':
    "import { readFile } from 'node:fs/promises'\n\nexport async function loadItems() {\n  return JSON.parse(await readFile(new URL('../data/items.json', import.meta.url), 'utf8'))\n}\n",
  'src/summary.js':
    'export function summarize(items) {\n  const tags = [...new Set(items.flatMap((i) => i.tags.map((t) => t.toLowerCase())))].sort()\n  return {\n    count: items.length,\n    units: items.reduce((n, i) => n + i.qty, 0),\n    revenue: Number(items.reduce((t, i) => t + i.price * i.qty, 0).toFixed(2)),\n    tags\n  }\n}\n',
  'src/app.js':
    "import http from 'node:http'\nimport { loadItems } from './store.js'\nimport { summarize } from './summary.js'\n\nfunction send(res, status, body) {\n  res.writeHead(status, { 'content-type': 'application/json' })\n  res.end(JSON.stringify(body))\n}\n\nexport function createServer() {\n  return http.createServer(async (req, res) => {\n    try {\n      const url = new URL(req.url, 'http://localhost')\n      if (url.pathname === '/api/items') return send(res, 200, await loadItems())\n      if (url.pathname === '/api/summary') return send(res, 200, summarize(await loadItems()))\n      send(res, 404, { error: 'not found' })\n    } catch (err) {\n      console.error('request failed:', err)\n      send(res, 500, { error: 'internal error' })\n    }\n  })\n}\n",
  'src/server.js':
    "import { createServer } from './app.js'\n\nconst server = createServer()\nserver.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => {\n  console.log(`listening on http://127.0.0.1:${server.address().port}`)\n})\n"
}

const SERVER_CHECK = `node --input-type=module -e "
import { createServer } from './src/app.js'
const s = createServer().listen(0, '127.0.0.1')
await new Promise((r) => s.once('listening', r))
const base = 'http://127.0.0.1:' + s.address().port
const a = await fetch(base + '/api/summary')
const sum = await a.json()
const b = await fetch(base + '/api/items')
const items = await b.json()
console.log(JSON.stringify({ sa: a.status, sum, sb: b.status, n: items.length }))
process.exit(0)
"`

/** Deterministic duration cases + the reference formatter the golden file comes from. */
function refFormatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

function goldenFile(): string {
  let x = 20260927
  const lines: string[] = []
  for (let i = 0; i < 20_000; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 1
    const ms = i % 3 === 0 ? x % 120_000 : x % 3_540_000
    lines.push(`${ms}\t${refFormatDuration(ms)}`)
  }
  return lines.join('\n') + '\n'
}

const DURATION_BUGGY =
  "/**\n * Compact human duration (under an hour): 950ms · 12.3s · 4m 05s\n */\nexport function formatDuration(ms) {\n  if (ms < 1000) return `${Math.round(ms)}ms`\n  const seconds = ms / 1000\n  if (seconds < 60) return `${seconds.toFixed(1)}s`\n  const minutes = Math.floor(seconds / 60)\n  const rest = Math.round(seconds % 60)\n  return `${minutes}m ${String(rest).padStart(2, '0')}s`\n}\n"

const GOLDEN_CHECK_JS =
  "import { readFileSync } from 'node:fs'\nimport { formatDuration } from './src/duration.js'\n\nconst lines = readFileSync(new URL('./golden.txt', import.meta.url), 'utf8').trim().split('\\n')\nlet bad = 0\nlet first = -1\nlines.forEach((line, i) => {\n  const [ms, want] = line.split('\\t')\n  const got = formatDuration(Number(ms))\n  if (got === want) console.log(`case ${i + 1}: ok (${want})`)\n  else {\n    bad++\n    if (first < 0) first = i + 1\n    console.log(`case ${i + 1}: MISMATCH formatDuration(${ms}) returned ${JSON.stringify(got)}, golden says ${JSON.stringify(want)}`)\n  }\n})\nconsole.log(`${lines.length - bad}/${lines.length} cases match${bad ? `, ${bad} mismatches (first at case ${first})` : ''}`)\nprocess.exit(bad ? 1 : 0)\n"

const GOLDEN = goldenFile()

/** A mid-sized repo where the relevant code shares no words with the bug report. */
function gateRepo(): Record<string, string> {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', type: 'module' }, null, 2),
    'src/net/gate.js':
      "/**\n * Sliding-window admission gate: at most `max` admissions per key within `windowMs`.\n */\nexport function createGate({ max, windowMs, now = () => Date.now() }) {\n  const hits = new Map()\n  return {\n    admit(key) {\n      const t = now()\n      const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs + 1000)\n      if (recent.length >= max) {\n        hits.set(key, recent)\n        return false\n      }\n      recent.push(t)\n      hits.set(key, recent)\n      return true\n    }\n  }\n}\n",
    'src/api/middleware.js':
      "import { createGate } from '../net/gate.js'\n\n// Keep abusive clients from overwhelming the service.\nconst gate = createGate({ max: 100, windowMs: 60_000 })\n\nexport function guard(req) {\n  const who = req.headers['x-client-id'] || req.socket.remoteAddress\n  return gate.admit(who) ? null : { status: 429, body: 'Too Many Requests' }\n}\n",
    'src/api/quota.js':
      "// Daily export quota per account; resets at local midnight.\nconst used = new Map()\nexport function consumeExport(account, limit = 20, today = new Date().toDateString()) {\n  const key = `${account}:${today}`\n  const n = used.get(key) || 0\n  if (n >= limit) return false\n  used.set(key, n + 1)\n  return true\n}\n",
    'src/util/retry.js':
      "// Retry an async operation with exponential backoff inside a time window.\nexport async function retry(fn, { attempts = 4, baseMs = 100, windowMs = 10_000 } = {}) {\n  const start = Date.now()\n  for (let i = 0; ; i++) {\n    try {\n      return await fn()\n    } catch (err) {\n      if (i + 1 >= attempts || Date.now() - start > windowMs) throw err\n      await new Promise((r) => setTimeout(r, baseMs * 2 ** i))\n    }\n  }\n}\n",
    'src/util/text.js':
      "export function truncate(text, limit = 80) {\n  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text\n}\n\nexport function paginate(items, { page = 1, limit = 20 } = {}) {\n  return items.slice((page - 1) * limit, page * limit)\n}\n"
  }
  const areas = ['billing', 'catalog', 'shipping', 'inventory', 'accounts', 'reports', 'search', 'media', 'notify', 'audit']
  const verbs = ['build', 'parse', 'merge', 'score', 'group', 'render', 'encode', 'filter', 'sort', 'resolve']
  const nouns = ['record', 'entry', 'batch', 'label', 'summary', 'token', 'bucket', 'segment', 'profile', 'draft']
  for (let a = 0; a < areas.length; a++) {
    for (let k = 0; k < 7; k++) {
      const v = verbs[(a * 3 + k) % verbs.length]
      const n = nouns[(a + k * 2) % nouns.length]
      const fn = `${v}${n[0].toUpperCase()}${n.slice(1)}`
      files[`src/${areas[a]}/${n}-${k}.js`] =
        `// ${areas[a]}: ${v} a ${n}\nexport function ${fn}(input, options = {}) {\n  const items = Array.isArray(input) ? input : [input]\n  const out = items.map((item, i) => ({ ...item, index: i, area: '${areas[a]}' }))\n  return options.limit ? out.slice(0, options.limit) : out\n}\n\nexport const ${n.toUpperCase()}_${k}_VERSION = ${a * 10 + k}\n`
    }
  }
  return files
}

const GATE_CHECK = `node --input-type=module -e "
import { createGate } from './src/net/gate.js'
let t = 0
const g = createGate({ max: 2, windowMs: 1000, now: () => t })
const out = []
for (const at of [0, 10, 500, 1050, 1055, 1100, 1101]) { t = at; out.push(g.admit('k')) }
console.log(JSON.stringify(out))
"`

const LRU_BUGGY =
  "/** Least-recently-used cache (doubly linked list + map). */\nexport class LRU {\n  constructor(capacity) {\n    this.capacity = capacity\n    this.map = new Map()\n    this.head = null\n    this.tail = null\n  }\n\n  get(key) {\n    const node = this.map.get(key)\n    if (!node) return undefined\n    this.#toFront(node)\n    return node.value\n  }\n\n  set(key, value) {\n    let node = this.map.get(key)\n    if (node) {\n      node.value = value\n      this.#toFront(node)\n      return\n    }\n    node = { key, value, prev: null, next: this.head }\n    if (this.head) this.head.prev = node\n    this.head = node\n    if (!this.tail) this.tail = node\n    this.map.set(key, node)\n    if (this.map.size > this.capacity) this.#evict()\n  }\n\n  keys() {\n    const out = []\n    for (let n = this.head; n; n = n.next) out.push(n.key)\n    return out\n  }\n\n  #toFront(node) {\n    if (node === this.head) return\n    if (node.prev) node.prev.next = node.next\n    if (node.next) node.next.prev = node.prev\n    node.prev = null\n    node.next = this.head\n    this.head.prev = node\n    this.head = node\n  }\n\n  #evict() {\n    const last = this.tail\n    if (!last) return\n    this.map.delete(last.key)\n    this.tail = last.prev\n    if (this.tail) this.tail.next = null\n    else this.head = null\n  }\n}\n"

const LRU_TEST =
  "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { LRU } from '../src/lru.js'\n\ntest('evicts the least recently used key', () => {\n  const c = new LRU(2)\n  c.set('a', 1)\n  c.set('b', 2)\n  c.get('a')\n  c.set('c', 3)\n  assert.deepEqual(c.keys(), ['c', 'a'])\n  assert.equal(c.get('b'), undefined)\n})\n\ntest('long access sequence keeps order and size', () => {\n  const c = new LRU(3)\n  for (const k of ['a', 'b', 'c']) c.set(k, k)\n  c.get('a')\n  c.get('b')\n  c.set('d', 'd')\n  c.get('a')\n  c.set('e', 'e')\n  assert.deepEqual(c.keys(), ['e', 'a', 'd'])\n  assert.equal(c.map.size, 3)\n})\n"

const CART_FILES: Record<string, string> = {
  'package.json': PKG,
  'src/cart.js':
    "export class Cart {\n  constructor() {\n    this.items = []\n  }\n\n  add(name, price, qty = 1) {\n    this.items.push({ name, price, qty })\n    return this\n  }\n\n  total() {\n    return this.items.reduce((t, i) => t + i.price * i.qty, 0)\n  }\n}\n",
  'src/checkout.js':
    "export const SHIPPING = 5\n\nexport function checkout(cart) {\n  const total = cart.total() + SHIPPING\n  return { items: cart.items.length, shipping: SHIPPING, total }\n}\n",
  'src/invoice.js':
    "export function invoiceFor(customer, cart) {\n  const invoice = { customer, lines: cart.items.map((i) => `${i.qty} x ${i.name}`), total: 0 }\n  invoice.total = cart.total()\n  return invoice\n}\n",
  'src/report.js':
    "export function report(orders) {\n  const rows = orders.map((o) => ({ id: o.id, total: o.cart.total() }))\n  const total = rows.reduce((t, r) => t + r.total, 0)\n  return { rows, total }\n}\n",
  'src/discount.js':
    'export function applyDiscount(cart, pct) {\n  const total = cart.total()\n  return total - (total * pct) / 100\n}\n',
  'src/format.js':
    "export const money = (n) => '$' + n.toFixed(2)\n\nexport function describe(cart) {\n  return `${cart.items.length} items, ${money(cart.total())}`\n}\n",
  'src/stats.js':
    '// Page-view counter (unrelated to carts).\nexport const counter = {\n  n: 0,\n  total() {\n    return this.n\n  }\n}\n\nexport function bump() {\n  counter.n++\n  return counter.total()\n}\n',
  'test/cart.test.js':
    "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { Cart } from '../src/cart.js'\nimport { checkout } from '../src/checkout.js'\nimport { invoiceFor } from '../src/invoice.js'\nimport { report } from '../src/report.js'\nimport { applyDiscount } from '../src/discount.js'\nimport { describe as describeCart } from '../src/format.js'\nimport { counter, bump } from '../src/stats.js'\n\nconst cart = () => new Cart().add('pen', 2, 2).add('pad', 3)\n\ntest('renamed method', () => {\n  assert.equal(cart().subtotal(), 7)\n  assert.equal(Cart.prototype.total, undefined)\n})\ntest('checkout keeps its total field', () => assert.deepEqual(checkout(cart()), { items: 2, shipping: 5, total: 12 }))\ntest('invoice keeps its total field', () => assert.equal(invoiceFor('ada', cart()).total, 7))\ntest('report keeps row and grand totals', () => assert.deepEqual(report([{ id: 1, cart: cart() }, { id: 2, cart: cart() }]), { rows: [{ id: 1, total: 7 }, { id: 2, total: 7 }], total: 14 }))\ntest('discount', () => assert.equal(applyDiscount(cart(), 10), 6.3))\ntest('format', () => assert.equal(describeCart(cart()), '2 items, $7.00'))\ntest('unrelated counter.total() untouched', () => {\n  assert.equal(typeof counter.total, 'function')\n  assert.equal(bump(), 1)\n})\n"
}

const renameCart = (text: string): string => text.replace(/(cart|this|Cart\.prototype)\.total\(\)/g, '$1.subtotal()').replace(/^  total\(\) \{\n    return this\.items/m, '  subtotal() {\n    return this.items')

export const HARD_TASKS: EvalTask[] = [
  {
    id: 'server-500',
    title: 'Fix a runtime-only HTTP 500 in a running server',
    tags: ['hard', 'runtime', 'bugfix'],
    files: SERVER_FILES,
    prompt:
      'The API server (`npm start`) answers `GET /api/summary` with HTTP 500, while `/api/items` works. Find the root cause and fix the code — do not edit data/items.json. Verify the fix against the running server, then stop it.',
    check: async (ctx) => {
      const data = await ctx.read('data/items.json')
      if (data !== SERVER_FILES['data/items.json']) return { pass: false, detail: 'data/items.json was modified' }
      const r = await ctx.run(SERVER_CHECK, 30_000)
      let v: { sa?: number; sum?: unknown; sb?: number; n?: number } = {}
      try {
        v = JSON.parse(r.stdout.trim().split('\n').pop() || '{}')
      } catch {
        return { pass: false, detail: `server check failed: ${r.stderr.slice(0, 300)}` }
      }
      const want = JSON.stringify({ count: 3, units: 5, revenue: 6, tags: ['office', 'writing'] })
      if (v.sa !== 200 || JSON.stringify(v.sum) !== want) return { pass: false, detail: `/api/summary → ${v.sa} ${JSON.stringify(v.sum)}` }
      if (v.sb !== 200 || v.n !== 3) return { pass: false, detail: `/api/items → ${v.sb} (${v.n} items)` }
      return { pass: true }
    },
    reference: {
      'src/summary.js': SERVER_FILES['src/summary.js'].replace('i.tags.map(', '(i.tags || []).map(')
    },
    timeoutMs: 8 * 60_000
  },
  {
    id: 'golden-mismatch',
    title: 'Fix a formatter against a 20k-case golden file (huge noisy output)',
    tags: ['hard', 'noisy-output', 'bugfix'],
    files: {
      'package.json': JSON.stringify({ name: 'fmt', version: '1.0.0', type: 'module', scripts: { check: 'node check.js' } }, null, 2),
      'src/duration.js': DURATION_BUGGY,
      'check.js': GOLDEN_CHECK_JS,
      'golden.txt': GOLDEN
    },
    prompt: '`npm run check` compares src/duration.js with golden.txt and reports mismatches. Fix src/duration.js so the check passes. Do not edit golden.txt or check.js.',
    check: async (ctx) => {
      if ((await ctx.read('golden.txt')) !== GOLDEN || (await ctx.read('check.js')) !== GOLDEN_CHECK_JS) {
        return { pass: false, detail: 'golden.txt or check.js was modified' }
      }
      const r = await ctx.run('node check.js > /dev/null; echo "exit=$?"; node check.js | tail -1', 60_000)
      return /exit=0/.test(r.stdout) ? { pass: true } : { pass: false, detail: r.stdout.trim().split('\n').pop() }
    },
    reference: {
      'src/duration.js':
        "export function formatDuration(ms) {\n  if (ms < 1000) return `${Math.round(ms)}ms`\n  if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`\n  const total = Math.round(ms / 1000)\n  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`\n}\n"
    },
    timeoutMs: 8 * 60_000
  },
  {
    id: 'concept-search',
    title: 'Locate and fix code by behaviour in a 75-file repo (no shared words)',
    tags: ['hard', 'navigation', 'bugfix'],
    files: gateRepo(),
    prompt:
      'Customers report that once they hit the request limit, they stay locked out for about a second longer than the configured window. Find the code responsible and fix it. Keep its public API unchanged.',
    check: async (ctx) => {
      const r = await ctx.run(GATE_CHECK, 30_000)
      const got = r.stdout.trim()
      const want = JSON.stringify([true, true, false, true, true, false, false])
      if (got !== want) return { pass: false, detail: `admission sequence ${got || r.stderr.slice(0, 200)} (want ${want})` }
      const mw = await ctx.read('src/api/middleware.js')
      if (!mw?.includes("createGate({ max: 100, windowMs: 60_000 })")) return { pass: false, detail: 'middleware configuration changed' }
      return { pass: true }
    },
    reference: {
      'src/net/gate.js': gateRepo()['src/net/gate.js'].replace('t - ts < windowMs + 1000', 't - ts < windowMs')
    },
    timeoutMs: 8 * 60_000
  },
  {
    id: 'lru-eviction',
    title: 'Fix a stateful linked-list bug (wrong eviction)',
    tags: ['hard', 'bugfix', 'stateful'],
    files: { 'package.json': PKG, 'src/lru.js': LRU_BUGGY, 'test/lru.test.js': LRU_TEST },
    prompt: 'The LRU cache in src/lru.js sometimes evicts the wrong entry (see `npm test`). Fix the root cause without changing the tests.',
    check: async (ctx) => {
      if ((await ctx.read('test/lru.test.js')) !== LRU_TEST) return { pass: false, detail: 'tests were modified' }
      return testsPass(ctx)
    },
    reference: {
      'src/lru.js': LRU_BUGGY.replace(
        '    if (node.next) node.next.prev = node.prev\n    node.prev = null',
        '    if (node.next) node.next.prev = node.prev\n    if (node === this.tail) this.tail = node.prev\n    node.prev = null'
      )
    },
    timeoutMs: 8 * 60_000
  },
  {
    id: 'rename-method',
    title: 'Rename a method across 6 files without touching same-named fields',
    tags: ['hard', 'refactor', 'multi-file'],
    files: CART_FILES,
    prompt:
      'Rename the `Cart` method `total()` to `subtotal()` everywhere it is used — it is confusing next to order totals. Keep everything else unchanged, including the `total` fields of checkout results, invoices and reports, and anything that is not a Cart. `npm test` has the expected behaviour.',
    check: async (ctx) => {
      if ((await ctx.read('test/cart.test.js')) !== CART_FILES['test/cart.test.js']) return { pass: false, detail: 'tests were modified' }
      return testsPass(ctx)
    },
    reference: Object.fromEntries(
      ['src/cart.js', 'src/checkout.js', 'src/invoice.js', 'src/report.js', 'src/discount.js', 'src/format.js'].map((f) => [f, renameCart(CART_FILES[f])])
    ),
    timeoutMs: 8 * 60_000
  }
]

BUILTIN_TASKS.push(...HARD_TASKS)

export function selectTasks(ids?: string[]): EvalTask[] {
  if (!ids?.length) return BUILTIN_TASKS
  const want = new Set(ids)
  const found = BUILTIN_TASKS.filter((t) => want.has(t.id) || t.tags.some((tag) => want.has(tag)))
  return found
}
