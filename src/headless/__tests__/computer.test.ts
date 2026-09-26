/**
 * Computer use through the whole agent loop (router → tool calls → engine →
 * native helper → tool results → model), with a scripted OpenAI-compatible
 * model. The halt-semantics test needs no desktop; the Calculator test drives
 * the real Mac and only runs with PAWN_CUA_E2E=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { existsSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runHeadlessTurn } from '../runner'
import type { HeadlessConfig } from '../nodeApi'
import { acquireDesktop } from '../../main/computer/__tests__/desktopLock'

type Step = (ctx: { toolResults: string[]; messages: any[] }) => { tools?: Array<{ name: string; args: Record<string, unknown> }>; text?: string }

let server: Server
let baseUrl = ''
let script: Step = () => ({ text: 'ok' })
const requests: any[] = []

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
      const chunks: unknown[] = []
      if (step.text) chunks.push({ choices: [{ index: 0, delta: { content: step.text } }] })
      ;(step.tools || []).forEach((t, i) =>
        chunks.push({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: i, id: `call_${toolResults.length}_${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }] }
            }
          ]
        })
      )
      chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: step.tools?.length ? 'tool_calls' : 'stop' }] })
      chunks.push({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 20 } })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

function config(): HeadlessConfig {
  return {
    settings: { routingMode: 'auto', doneGate: 'off' },
    providers: [{ id: 'fake', name: 'Fake', apiFormat: 'openai', baseUrl, apiKey: 'k', enabled: true }],
    models: [
      {
        id: 'fake:m',
        providerId: 'fake',
        modelId: 'fake-model',
        label: 'Fake',
        tier: 'mid',
        enabled: true,
        supportsTools: true,
        supportsVision: true,
        contextWindow: 128_000,
        pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 }
      }
    ]
  }
}

describe('computer batches in the agent loop', () => {
  it('halts the rest of a computer batch after the first failure', async () => {
    script = ({ toolResults }) =>
      toolResults.length === 0
        ? {
            tools: [
              { name: 'computer_click', args: { coordinate: [10, 10] } },
              { name: 'computer_type', args: { text: 'hi' } },
              { name: 'computer_key', args: { key: 'Return' } }
            ]
          }
        : { text: `results: ${toolResults.join(' | ')}` }
    const dir = await mkdtemp(join(tmpdir(), 'pawn-cu-'))
    try {
      // computer: false → no desktop bridge, so the first action fails.
      const res = await runHeadlessTurn({ prompt: 'use the computer to click', cwd: dir, config: config(), permission: 'yolo', timeoutMs: 30_000 })
      expect(res.tools.map((t) => `${t.name}:${t.status}`)).toEqual(['computer_click:error', 'computer_type:error', 'computer_key:error'])
      expect(res.finalText).toContain('only available in the desktop app')
      expect(res.finalText.match(/Not executed: an earlier computer action in this turn failed\./g)).toHaveLength(2)
      // The computer group was loaded for the request (tool diet + keyword).
      const names: string[] = (requests[0].tools || []).map((t: any) => t.function.name)
      expect(names).toContain('computer_click')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

const BIN = join(process.cwd(), 'native', 'macos', 'build', 'pawn-cua')
const E2E = process.platform === 'darwin' && existsSync(BIN) && process.env.PAWN_CUA_E2E === '1'

describe.skipIf(!E2E)('real desktop through the agent loop (PAWN_CUA_E2E=1)', () => {
  let release: (() => void) | undefined
  beforeAll(async () => {
    release = await acquireDesktop()
  }, 200_000)
  afterAll(() => release?.())

  it('launches Calculator, reads its UI, computes 12×3 by element clicks, and verifies', async () => {
    const ids = (snap: string, label: string): number | undefined => {
      const m = new RegExp(`\\[(\\d+)\\] button "${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).exec(snap)
      return m ? Number(m[1]) : undefined
    }
    let snapshot = ''
    script = ({ toolResults }) => {
      const n = toolResults.length
      if (n === 0) return { tools: [{ name: 'computer_apps', args: { action: 'launch', bundle_id: 'com.apple.calculator' } }] }
      if (n === 1) return { tools: [{ name: 'computer_ui_snapshot', args: { app: 'com.apple.calculator' } }] }
      if (n === 2) {
        snapshot = toolResults[1]
        const clear = ['All Clear', 'Clear', 'AC', 'C', '지우기', '전체 삭제'].map((l) => ids(snapshot, l)).find((x) => x !== undefined)
        const times = ['Multiply', '곱하기', '×'].map((l) => ids(snapshot, l)).find((x) => x !== undefined)
        const equals = ['Equals', '등호', '='].map((l) => ids(snapshot, l)).find((x) => x !== undefined)
        const seq = [clear, ids(snapshot, '1'), ids(snapshot, '2'), times, ids(snapshot, '3'), equals].filter((x) => x !== undefined)
        return { tools: seq.map((element) => ({ name: 'computer_click', args: { element } })) }
      }
      const last = toolResults[toolResults.length - 1]
      if (!last.startsWith('App:')) return { tools: [{ name: 'computer_ui_snapshot', args: { app: 'com.apple.calculator' } }] }
      return { text: `final: ${last}` }
    }
    const dir = await mkdtemp(join(tmpdir(), 'pawn-cu-'))
    const { execFileSync } = await import('child_process')
    let wasRunning = true
    try {
      execFileSync('pgrep', ['-x', 'Calculator'])
    } catch {
      wasRunning = false
    }
    try {
      const res = await runHeadlessTurn({
        prompt: 'Use the computer: open Calculator and compute 12 × 3.',
        cwd: dir,
        config: config(),
        permission: 'yolo',
        computer: true,
        timeoutMs: 60_000
      })
      const statuses = res.tools.map((t) => `${t.name}:${t.status}`)
      expect(statuses.slice(0, 2)).toEqual(['computer_apps:ok', 'computer_ui_snapshot:ok'])
      expect(res.tools.filter((t) => t.name === 'computer_click').every((t) => t.status === 'ok')).toBe(true)
      expect(snapshot).toMatch(/\[\d+\] button "1"/)
      expect(res.finalText).toMatch(/= "36"/)
    } finally {
      await rm(dir, { recursive: true, force: true })
      if (!wasRunning) {
        try {
          execFileSync('osascript', ['-e', 'tell application id "com.apple.calculator" to quit'])
        } catch {
          /* not running */
        }
      }
    }
  }, 90_000)
})
