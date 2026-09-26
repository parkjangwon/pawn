import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runHeadlessTurn } from '../runner'
import { formatEvalReport, runEvalSuite, summarize } from '../evalHarness'
import { BUILTIN_TASKS, selectTasks } from '../evalTasks'
import { applyEnvKeys, envKeyName } from '../config'
import { evalConfigs, parseArgs } from '../cli'
import type { HeadlessConfig } from '../nodeApi'

/**
 * Scripted OpenAI-compatible provider. Each request's reply depends on how
 * many tool results the conversation already has, so the real agent loop
 * walks through: read_file → edit_file → final answer.
 */
type Step = (req: { toolResults: string[]; messages: any[] }) => { tool?: { name: string; args: Record<string, unknown> }; text?: string }

let server: Server
let baseUrl = ''
let script: Step = () => ({ text: 'ok' })
const requests: any[] = []

function sse(res: import('http').ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const json = JSON.parse(body || '{}')
      requests.push(json)
      const messages: any[] = json.messages || []
      const toolResults = messages.filter((m) => m.role === 'tool').map((m) => String(m.content))
      const step = script({ toolResults, messages })
      if (json.stream === false) {
        // Non-streaming (evaluator / summarizer) requests get a plain JSON body.
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            choices: [{ index: 0, message: { role: 'assistant', content: step.text || '' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 300, completion_tokens: 20 }
          })
        )
        return
      }
      const chunks: unknown[] = []
      if (step.text) chunks.push({ choices: [{ index: 0, delta: { content: step.text } }] })
      if (step.tool) {
        chunks.push({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: `call_${toolResults.length}`, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }
                ]
              }
            }
          ]
        })
      }
      chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: step.tool ? 'tool_calls' : 'stop' }] })
      chunks.push({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_cache_hit_tokens: 200 } })
      sse(res, chunks)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

function fakeConfig(): HeadlessConfig {
  return {
    settings: { routingMode: 'auto', permissionMode: 'yolo', doneGate: 'off', harnessMode: 'default' },
    providers: [{ id: 'fake', name: 'Fake', apiFormat: 'openai', baseUrl, apiKey: 'test-key', enabled: true }],
    models: [
      {
        id: 'fake:m1',
        providerId: 'fake',
        modelId: 'fake-model',
        label: 'Fake Model',
        tier: 'mid',
        enabled: true,
        supportsTools: true,
        contextWindow: 128_000,
        pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 }
      }
    ]
  }
}

const fixScript: Step = ({ toolResults }) => {
  if (toolResults.length === 0) return { tool: { name: 'read_file', args: { path: 'src/stats.js' } } }
  if (toolResults.length === 1) {
    return {
      tool: {
        name: 'edit_file',
        args: { path: 'src/stats.js', old_string: 'i < values.length - 1', new_string: 'i < values.length' }
      }
    }
  }
  return { text: 'Fixed the off-by-one in `sum()`; tests pass now.' }
}

describe('headless runner (real agent loop, scripted provider)', () => {
  it('runs a full tool-using turn and edits the working tree', async () => {
    script = fixScript
    requests.length = 0
    const dir = await mkdtemp(join(tmpdir(), 'pawn-headless-'))
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src/stats.js'), 'export function sum(values) {\n  let total = 0\n  for (let i = 0; i < values.length - 1; i++) total += values[i]\n  return total\n}\n')
    const home = await mkdtemp(join(tmpdir(), 'pawn-home-'))
    try {
      const res = await runHeadlessTurn({ prompt: 'fix sum', cwd: dir, config: fakeConfig(), permission: 'yolo', homeDir: home, timeoutMs: 30_000 })
      expect(res.outcome).toBe('completed')
      expect(res.ok).toBe(true)
      expect(res.finalText).toContain('Fixed the off-by-one')
      expect(res.tools.map((t) => `${t.name}:${t.status}`)).toEqual(['read_file:ok', 'edit_file:ok'])
      expect(res.tools[1]).toMatchObject({ added: 1, removed: 1 })
      expect(res.usage.calls).toBe(3)
      expect(res.usage.inputTokens).toBeGreaterThan(0)
      expect(res.usage.cost).toBeGreaterThan(0)
      expect(await readFile(join(dir, 'src/stats.js'), 'utf8')).toContain('i < values.length; i++')
      // The request carried the tool schemas, with optional groups dieted away.
      const toolNames: string[] = (requests[0].tools || []).map((t: any) => t.function.name)
      expect(toolNames).toContain('edit_file')
      expect(toolNames).not.toContain('browser_navigate')
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  }, 60_000)

  it('answers ask_user with the recommended option instead of hanging', async () => {
    script = ({ toolResults }) =>
      toolResults.length === 0
        ? { tool: { name: 'ask_user', args: { question: 'Which style?', options: [{ label: 'tabs' }, { label: 'spaces' }] } } }
        : { text: `got: ${toolResults[0]}` }
    const dir = await mkdtemp(join(tmpdir(), 'pawn-headless-'))
    try {
      const res = await runHeadlessTurn({ prompt: 'format', cwd: dir, config: fakeConfig(), permission: 'yolo', timeoutMs: 30_000 })
      expect(res.finalText).toContain('The user chose: tabs')
      expect(res.autoAnswers[0]).toContain('Which style?')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('eval harness', () => {
  it('materializes a task, runs the agent, scores it, and reports metrics', async () => {
    script = fixScript
    const report = await runEvalSuite(selectTasks(['fix-off-by-one']), [{ label: 'default', harnessMode: 'default' }], {
      config: fakeConfig()
    })
    expect(report.results).toHaveLength(1)
    const r = report.results[0]
    expect(r).toMatchObject({ taskId: 'fix-off-by-one', pass: true, outcome: 'completed', toolCalls: 2, toolErrors: 0 })
    expect(r.cost).toBeGreaterThan(0)
    expect(report.summaries[0]).toMatchObject({ config: 'default', runs: 1, passed: 1, passRate: 1 })
    const md = formatEvalReport(report)
    expect(md).toContain('| default | 1/1 | 100% |')
    expect(md).toContain('✅ pass')
  }, 90_000)

  it('fails a task when the agent does not fix it', async () => {
    script = () => ({ text: 'I looked but did nothing.' })
    const report = await runEvalSuite(selectTasks(['fix-off-by-one']), [{ label: 'lazy' }], { config: fakeConfig() })
    expect(report.results[0].pass).toBe(false)
    expect(report.results[0].detail).toContain('node --test exited')
  }, 90_000)

  it('ships self-consistent built-in tasks (each fixture fails before the fix)', async () => {
    // Guard against a fixture that passes untouched (it would measure nothing).
    const runner = async () => ({
      ok: true,
      outcome: 'completed' as const,
      finalText: '',
      assistantMessages: 1,
      tools: [],
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
      durationMs: 1,
      models: [],
      autoAnswers: []
    })
    const report = await runEvalSuite(BUILTIN_TASKS, [{ label: 'noop' }], { config: fakeConfig(), runner })
    for (const r of report.results) expect(r.pass, r.taskId).toBe(false)
  }, 120_000)

  it('summarizes pass rate and cost per pass', () => {
    const base = { attempt: 1, outcome: 'completed' as const, durationMs: 1000, toolCalls: 2, toolErrors: 0, assistantMessages: 1, inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, models: [] }
    const s = summarize([
      { ...base, taskId: 'a', config: 'eco', pass: true, cost: 0.01 },
      { ...base, taskId: 'b', config: 'eco', pass: false, cost: 0.03 }
    ])
    expect(s[0]).toMatchObject({ runs: 2, passed: 1, passRate: 0.5, totalCost: 0.04, costPerPass: 0.04 })
  })
})

describe('headless config + cli args', () => {
  it('takes keys from env, drops keychain-encrypted keys, and disables keyless providers', () => {
    const { config, missing } = applyEnvKeys(
      {
        providers: [
          { id: 'ds', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: 'enc:v1:xxx', enabled: true },
          { id: 'oa', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', enabled: true },
          { id: 'local', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', enabled: true }
        ]
      },
      { DEEPSEEK_API_KEY: 'sk-ds', [envKeyName('oa')]: '' }
    )
    const byId = Object.fromEntries((config.providers || []).map((p) => [p.id, p]))
    expect(byId.ds).toMatchObject({ apiKey: 'sk-ds', enabled: true })
    expect(byId.oa).toMatchObject({ enabled: false })
    expect(byId.local).toMatchObject({ enabled: true })
    expect(missing[0]).toContain('PAWN_API_KEY_OA')
  })

  it('parses flags and builds eval configs', () => {
    const a = parseArgs(['eval', '--tasks', 'bugfix,rename-symbol', '--modes=eco,maxing', '--models', 'm1', '--keep'])
    expect(a).toEqual({ command: 'eval', positional: [], flags: { tasks: 'bugfix,rename-symbol', modes: 'eco,maxing', models: 'm1', keep: true } })
    expect(evalConfigs(a.flags).map((c) => c.label)).toEqual(['eco·m1', 'maxing·m1'])
    expect(selectTasks(['bugfix']).map((t) => t.id)).toEqual(['fix-off-by-one', 'fix-async-bug'])
    expect(parseArgs(['--help']).command).toBe('help')
    expect(parseArgs([]).command).toBe('help')
  })
})

describe('Ultra Work loop (real agent loop + evaluator)', () => {
  it('keeps iterating until the evaluator confirms the goal, forcing MAXING', async () => {
    let agentTurns = 0
    let evalCalls = 0
    script = ({ messages }) => {
      const system = String(messages[0]?.content || '')
      // Evaluator requests carry the evaluator system prompt.
      if (system.includes('You judge whether an autonomous coding agent')) {
        evalCalls++
        return {
          text:
            evalCalls === 1
              ? '{"met": false, "reason": "No test run shown yet — run the tests."}'
              : '{"met": true, "reason": "Tests shown passing."}'
        }
      }
      agentTurns++
      const preamble = messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n')
      expect(preamble).toContain('ULTRA WORK MODE')
      expect(preamble).toContain('MAXING')
      return { text: agentTurns === 1 ? 'Implemented it. <ultrawork>DONE</ultrawork>' : 'Ran tests: 3 passed. <ultrawork>DONE</ultrawork>' }
    }
    const dir = await mkdtemp(join(tmpdir(), 'pawn-ulw-'))
    try {
      const res = await runHeadlessTurn({
        prompt: 'make all tests pass',
        cwd: dir,
        config: fakeConfig(),
        permission: 'yolo',
        ultraWork: { maxIterations: 5 },
        timeoutMs: 60_000
      })
      expect(res.ultraWork).toMatchObject({ status: 'achieved', iterations: 2, reason: 'Tests shown passing.' })
      expect(agentTurns).toBe(2)
      expect(evalCalls).toBe(2)
      expect(res.finalText).toContain('3 passed')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 90_000)

  it('stops at the iteration budget', async () => {
    script = ({ messages }) => {
      const system = String(messages[0]?.content || '')
      if (system.includes('You judge whether an autonomous coding agent')) return { text: '{"met": false, "reason": "still failing"}' }
      return { text: 'working on it' }
    }
    const dir = await mkdtemp(join(tmpdir(), 'pawn-ulw-'))
    try {
      const res = await runHeadlessTurn({
        prompt: 'impossible goal',
        cwd: dir,
        config: fakeConfig(),
        permission: 'yolo',
        ultraWork: { maxIterations: 2 },
        timeoutMs: 60_000
      })
      expect(res.ultraWork).toMatchObject({ status: 'budget_limited', iterations: 2, reason: 'still failing' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 90_000)
})

