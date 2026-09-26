/**
 * pawn-headless — run the Pawn agent without the desktop app.
 *
 *   pawn-headless run "fix the failing test" [--cwd DIR] [--mode default|eco|maxing]
 *                 [--model MODEL_ID] [--permission auto|yolo|deny] [--plan] [--json]
 *   pawn-headless eval [--tasks id,tag] [--modes default,eco,maxing] [--models ID,ID]
 *                 [--repeat N] [--out report.md] [--json-out report.json] [--keep]
 *   pawn-headless tasks
 *
 * Common: [--config config.json] (default ~/.pawn/config.toml; API keys from
 * env: PAWN_API_KEY_<PROVIDER_ID> or OPENAI_API_KEY / ANTHROPIC_API_KEY / …).
 */

import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import { loadHeadlessConfig } from './config'
import { runHeadlessTurn, type HeadlessPermission } from './runner'
import { formatEvalReport, runEvalSuite, type EvalConfig } from './evalHarness'
import { BUILTIN_TASKS, selectTasks } from './evalTasks'

export interface ParsedArgs {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
}

export function parseArgs(argv: string[]): ParsedArgs {
  // `pawn-headless --help` / `-h` with no command.
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return { command: 'help', positional: [], flags: {} }
  const [command, ...rest] = argv
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2)
      if (v !== undefined) flags[k] = v
      else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) flags[k] = rest[++i]
      else flags[k] = true
    } else positional.push(a)
  }
  return { command, positional, flags }
}

const list = (v: unknown): string[] =>
  typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []

const MODES = new Set(['default', 'eco', 'maxing'])

export function evalConfigs(flags: Record<string, string | boolean>): EvalConfig[] {
  const modes = list(flags.modes).filter((m) => MODES.has(m)) as EvalConfig['harnessMode'][]
  const models = list(flags.models)
  const ms = modes.length ? modes : ['default' as const]
  if (!models.length) return ms.map((m) => ({ label: m!, harnessMode: m }))
  return ms.flatMap((m) => models.map((id) => ({ label: `${m}·${id}`, harnessMode: m, modelId: id })))
}

const HELP = `pawn-headless — run the Pawn agent without the desktop app

  run "<prompt>"   one agent turn in --cwd (default: current dir)
  eval             run the built-in evaluation suite
  tasks            list eval tasks

Flags: --config FILE  --mode default|eco|maxing  --model ID  --permission auto|yolo|deny
       --plan (start in Plan mode, auto-approve the plan)  --json
       --ulw [--max-iterations N]  Ultra Work: loop until the goal is verified done
Eval:  --tasks ids/tags  --modes a,b  --models id,id  --repeat N  --out FILE.md  --json-out FILE.json  --keep
Keys:  PAWN_API_KEY_<PROVIDER_ID>, or OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY …`

export async function main(argv: string[]): Promise<number> {
  const { command, positional, flags } = parseArgs(argv)
  if (command === 'help' || flags.help) {
    console.log(HELP)
    return 0
  }
  if (command === 'tasks') {
    for (const t of BUILTIN_TASKS) console.log(`${t.id.padEnd(20)} [${t.tags.join(', ')}] ${t.title}`)
    return 0
  }
  const { config, missing } = await loadHeadlessConfig(typeof flags.config === 'string' ? flags.config : undefined)
  if (missing.length) console.error(`[pawn] providers without keys (disabled): ${missing.join('; ')}`)
  if (!(config.providers || []).some((p) => p.enabled)) {
    console.error('[pawn] no usable provider. Set an API key env var (see --help) or pass --config.')
    return 2
  }
  const verbose = flags.verbose === true
  const onLog = verbose ? (l: string) => console.error(l) : undefined

  if (command === 'run') {
    const prompt = positional.join(' ').trim()
    if (!prompt) {
      console.error('usage: pawn-headless run "<prompt>"')
      return 2
    }
    const mode = typeof flags.mode === 'string' && MODES.has(flags.mode) ? (flags.mode as 'default' | 'eco' | 'maxing') : undefined
    const permission = (['auto', 'yolo', 'deny'].includes(String(flags.permission)) ? flags.permission : 'auto') as HeadlessPermission
    const res = await runHeadlessTurn({
      prompt,
      cwd: resolve(typeof flags.cwd === 'string' ? flags.cwd : process.cwd()),
      config,
      harnessMode: mode,
      modelId: typeof flags.model === 'string' ? flags.model : undefined,
      permission,
      agentMode: flags.plan ? 'plan' : 'build',
      autoApprovePlan: true,
      ...(flags.ulw ? { ultraWork: { maxIterations: Number(flags['max-iterations']) || undefined } } : {}),
      onLog
    })
    if (flags.json) console.log(JSON.stringify(res, null, 2))
    else {
      console.log(res.finalText || '(no answer)')
      console.error(
        `\n[pawn] ${res.outcome} · ${(res.durationMs / 1000).toFixed(1)}s · ${res.tools.length} tools · ` +
          `${res.usage.inputTokens + res.usage.outputTokens} tokens · $${res.usage.cost.toFixed(4)}` +
          (res.ultraWork ? `\n[pawn] ultra work: ${res.ultraWork.status} after ${res.ultraWork.iterations} iteration(s)${res.ultraWork.reason ? ` — ${res.ultraWork.reason}` : ''}` : '') +
          (res.error ? `\n[pawn] error: ${res.error}` : '')
      )
    }
    return res.ok ? 0 : 1
  }

  if (command === 'eval') {
    const tasks = selectTasks(list(flags.tasks))
    if (!tasks.length) {
      console.error('[pawn] no tasks matched')
      return 2
    }
    const configs = evalConfigs(flags)
    console.error(`[pawn] eval: ${tasks.length} tasks × ${configs.length} configs × ${Number(flags.repeat) || 1}`)
    const report = await runEvalSuite(tasks, configs, {
      config,
      repeat: Number(flags.repeat) || 1,
      keepDirs: flags.keep === true,
      onLog,
      onResult: (r) =>
        console.error(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.taskId} [${r.config}] ${(r.durationMs / 1000).toFixed(1)}s $${r.cost.toFixed(4)}${r.detail ? ` — ${r.detail.split('\n')[0]}` : ''}`)
    })
    const md = formatEvalReport(report)
    console.log(md)
    if (typeof flags.out === 'string') await writeFile(flags.out, md, 'utf8')
    if (typeof flags['json-out'] === 'string') await writeFile(flags['json-out'], JSON.stringify(report, null, 2), 'utf8')
    return report.results.every((r) => r.pass) ? 0 : 1
  }

  console.error(`unknown command: ${command}\n\n${HELP}`)
  return 2
}

const isEntry = (() => {
  try {
    const entry = process.argv[1] || ''
    return /pawn-headless(\.m?js)?$/.test(entry)
  } catch {
    return false
  }
})()

if (isEntry) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.stack || err.message : String(err))
      process.exit(1)
    })
}
