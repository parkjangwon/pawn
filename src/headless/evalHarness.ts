/**
 * Evaluation harness: runs tasks through the real headless agent and scores
 * them objectively, per configuration (harness mode × model), so routing,
 * compaction, and prompt changes can be judged by numbers instead of vibes.
 */

import { spawn } from 'child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import type { HeadlessConfig } from './nodeApi'
import { runHeadlessTurn, type HeadlessTurnOptions, type HeadlessTurnResult } from './runner'
import type { EvalCheckContext, EvalTask } from './evalTasks'

export interface EvalConfig {
  label: string
  harnessMode?: 'default' | 'eco' | 'maxing'
  modelId?: string
}

export interface EvalRunResult {
  taskId: string
  config: string
  attempt: number
  pass: boolean
  detail?: string
  outcome: HeadlessTurnResult['outcome']
  durationMs: number
  toolCalls: number
  toolErrors: number
  assistantMessages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cost: number
  models: string[]
}

export interface EvalSummary {
  config: string
  runs: number
  passed: number
  passRate: number
  avgDurationMs: number
  avgToolCalls: number
  totalTokens: number
  avgTokens: number
  totalCost: number
  costPerPass: number | null
}

export interface EvalReport {
  startedAt: number
  finishedAt: number
  results: EvalRunResult[]
  summaries: EvalSummary[]
}

export type TurnRunner = (opts: HeadlessTurnOptions) => Promise<HeadlessTurnResult>

function runCommand(command: string, cwd: string, timeoutMs = 60_000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const isWin = process.platform === 'win32'
    const child = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/d', '/s', '/c', command] : ['-c', command], {
      cwd,
      env: { ...process.env, CI: '1', NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout = (stdout + c).slice(-200_000)))
    child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-200_000)))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      res({ exitCode: 124, stdout, stderr: `${stderr}\ncheck timed out` })
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      res({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      res({ exitCode: 1, stdout, stderr: String(err) })
    })
  })
}

export async function materializeTask(task: EvalTask): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `pawn-eval-${task.id}-`))
  for (const [rel, content] of Object.entries(task.files)) {
    const p = resolve(dir, rel)
    if (!p.startsWith(dir)) throw new Error(`fixture path escapes the task dir: ${rel}`)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, content, 'utf8')
  }
  // A git baseline lets the agent use git_diff / git_status like in a real repo.
  await runCommand('git init -q && git add -A && git -c user.email=eval@pawn -c user.name=pawn-eval commit -qm baseline', dir, 20_000)
  return dir
}

export async function runEvalTask(
  task: EvalTask,
  cfg: EvalConfig,
  opts: { config: HeadlessConfig; attempt?: number; keepDirs?: boolean; runner?: TurnRunner; onLog?: (line: string) => void }
): Promise<EvalRunResult> {
  const dir = await materializeTask(task)
  const home = await mkdtemp(join(tmpdir(), 'pawn-eval-home-'))
  const runner = opts.runner ?? runHeadlessTurn
  let turn: HeadlessTurnResult
  try {
    turn = await runner({
      homeDir: home,
      prompt: task.prompt,
      cwd: dir,
      config: opts.config,
      harnessMode: cfg.harnessMode,
      modelId: cfg.modelId,
      permission: 'yolo',
      autoApprovePlan: true,
      timeoutMs: task.timeoutMs ?? 10 * 60_000,
      onLog: opts.onLog
    })
  } catch (err) {
    turn = {
      ok: false,
      outcome: 'error',
      error: err instanceof Error ? err.message : String(err),
      finalText: '',
      assistantMessages: 0,
      tools: [],
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
      durationMs: 0,
      models: [],
      autoAnswers: []
    }
  }
  const ctx: EvalCheckContext = {
    dir,
    finalText: turn.finalText,
    run: (command, timeoutMs) => runCommand(command, dir, timeoutMs),
    read: async (rel) => {
      try {
        return await readFile(resolve(dir, rel), 'utf8')
      } catch {
        return null
      }
    }
  }
  let verdict: { pass: boolean; detail?: string }
  try {
    verdict = turn.outcome === 'error' && !turn.assistantMessages
      ? { pass: false, detail: turn.error || 'agent error' }
      : await task.check(ctx)
  } catch (err) {
    verdict = { pass: false, detail: `check crashed: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (turn.outcome === 'timeout') verdict = { pass: false, detail: `timeout${verdict.detail ? `; ${verdict.detail}` : ''}` }
  if (!opts.keepDirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
  await rm(home, { recursive: true, force: true }).catch(() => {})
  return {
    taskId: task.id,
    config: cfg.label,
    attempt: opts.attempt ?? 1,
    pass: verdict.pass,
    ...(verdict.detail ? { detail: verdict.detail } : {}),
    outcome: turn.outcome,
    durationMs: turn.durationMs,
    toolCalls: turn.tools.length,
    toolErrors: turn.tools.filter((t) => t.status === 'error').length,
    assistantMessages: turn.assistantMessages,
    inputTokens: turn.usage.inputTokens,
    outputTokens: turn.usage.outputTokens,
    cacheReadTokens: turn.usage.cacheReadTokens,
    cost: turn.usage.cost,
    models: turn.models
  }
}

export function summarize(results: EvalRunResult[]): EvalSummary[] {
  const byCfg = new Map<string, EvalRunResult[]>()
  for (const r of results) byCfg.set(r.config, [...(byCfg.get(r.config) || []), r])
  return Array.from(byCfg.entries()).map(([config, rs]) => {
    const passed = rs.filter((r) => r.pass).length
    const totalTokens = rs.reduce((n, r) => n + r.inputTokens + r.outputTokens + r.cacheReadTokens, 0)
    const totalCost = rs.reduce((n, r) => n + r.cost, 0)
    return {
      config,
      runs: rs.length,
      passed,
      passRate: rs.length ? passed / rs.length : 0,
      avgDurationMs: rs.length ? rs.reduce((n, r) => n + r.durationMs, 0) / rs.length : 0,
      avgToolCalls: rs.length ? rs.reduce((n, r) => n + r.toolCalls, 0) / rs.length : 0,
      totalTokens,
      avgTokens: rs.length ? totalTokens / rs.length : 0,
      totalCost,
      costPerPass: passed ? totalCost / passed : null
    }
  })
}

export async function runEvalSuite(
  tasks: EvalTask[],
  configs: EvalConfig[],
  opts: { config: HeadlessConfig; repeat?: number; keepDirs?: boolean; runner?: TurnRunner; onResult?: (r: EvalRunResult) => void; onLog?: (line: string) => void }
): Promise<EvalReport> {
  const startedAt = Date.now()
  const results: EvalRunResult[] = []
  const repeat = Math.max(1, Math.min(10, opts.repeat ?? 1))
  // Sequential on purpose: runs share the process-wide stores, and parallel
  // runs would also skew latency numbers.
  for (const cfg of configs) {
    for (const task of tasks) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        const r = await runEvalTask(task, cfg, { ...opts, attempt })
        results.push(r)
        opts.onResult?.(r)
      }
    }
  }
  return { startedAt, finishedAt: Date.now(), results, summaries: summarize(results) }
}

function fmtMs(ms: number): string {
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`
}

function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = []
  lines.push(`# Pawn eval — ${new Date(report.startedAt).toISOString()}`, '')
  lines.push('| Config | Pass | Rate | Avg time | Avg tools | Avg tokens | Cost | $/pass |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const s of report.summaries) {
    lines.push(
      `| ${s.config} | ${s.passed}/${s.runs} | ${(s.passRate * 100).toFixed(0)}% | ${fmtMs(s.avgDurationMs)} | ${s.avgToolCalls.toFixed(1)} | ${fmtTokens(s.avgTokens)} | $${s.totalCost.toFixed(4)} | ${s.costPerPass === null ? '—' : `$${s.costPerPass.toFixed(4)}`} |`
    )
  }
  lines.push('', '| Task | Config | # | Result | Time | Tools (err) | Tokens in/out/cache | Cost | Models | Detail |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const r of report.results) {
    lines.push(
      `| ${r.taskId} | ${r.config} | ${r.attempt} | ${r.pass ? '✅ pass' : '❌ fail'} | ${fmtMs(r.durationMs)} | ${r.toolCalls} (${r.toolErrors}) | ${fmtTokens(r.inputTokens)}/${fmtTokens(r.outputTokens)}/${fmtTokens(r.cacheReadTokens)} | $${r.cost.toFixed(4)} | ${r.models.join(', ') || '—'} | ${(r.detail || '').replace(/\n/g, ' ').replace(/\|/g, '\\|').slice(0, 160)} |`
    )
  }
  lines.push('', `Total wall time: ${fmtMs(report.finishedAt - report.startedAt)}`)
  return lines.join('\n')
}
