// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { analyzeProcessOutput, collectRuntimeEvents, formatAnalysis, watchJob } from '../runtimeWatch'
import { extractMentionedPaths, formatPrefetched, prefetchMentionedFiles } from '../mentionPrefetch'
import { classifyCommand, detectProfile, formatProfileBlock, learnFromCommand, loadProfile, _resetProfileCache } from '../repoProfile'
import { detectCorrection, heuristicLesson, noteRevert, takeRecentRevert } from '../correctionLearning'
import { learnFromCorrection } from '../learning'
import { executeTool } from '../toolExecutor'
import { withPageEvents } from '../toolHandlers/runtime'
import { callLLM } from '../llm'
import { useProviderStore } from '../../stores/provider'
import type { ToolCall } from '../toolDefinitionsTypes'

beforeEach(() => {
  useProviderStore.setState({ permissionMode: 'yolo', agentMode: 'build', sessionAgentModes: {} } as any)
})

describe('process output analysis', () => {
  it('finds dev-server URLs, ports and readiness', () => {
    const vite = '\u001b[32m  VITE v6.0.0  ready in 312 ms\u001b[0m\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose'
    const a = analyzeProcessOutput(vite)
    expect(a.urls).toEqual(['http://localhost:5173/'])
    expect(a.ports).toEqual([5173])
    expect(a.ready).toBe(true)
    expect(a.errors).toEqual([])
    expect(analyzeProcessOutput('Server listening on port 8080').ports).toEqual([8080])
    expect(analyzeProcessOutput('Starting development server at http://127.0.0.1:8000/').urls).toEqual(['http://127.0.0.1:8000/'])
    expect(formatAnalysis(a)).toBe('[detected] urls: http://localhost:5173/ · looks ready')
  })

  it('extracts error lines with the first stack frame, ignoring "0 errors"', () => {
    const out = 'compiled with 0 errors\nTypeError: Cannot read properties of undefined (reading "id")\n    at handler (/app/src/api.ts:12:9)\n    at next (/app/node_modules/x.js:1:1)\nError: listen EADDRINUSE: address already in use :::3000\nTraceback (most recent call last):'
    const a = analyzeProcessOutput(out)
    expect(a.errors).toEqual([
      'TypeError: Cannot read properties of undefined (reading "id")',
      '  at handler (/app/src/api.ts:12:9)',
      'Error: listen EADDRINUSE: address already in use :::3000',
      'Traceback (most recent call last):'
    ])
  })

  it('reports only new job errors and page errors, once', async () => {
    let stdout = 'ready\n'
    let status = 'running'
    const poll = vi.fn(async () => ({ status, stdout, stderr: '', exitCode: status === 'exited' ? 1 : null }))
    const runtime = vi.fn(async (_o?: string, opts?: { since?: number }) => ({
      ok: true,
      latestSeq: 7,
      events: (opts?.since || 0) < 7 ? [{ kind: 'exception', level: 'error', text: 'Uncaught ReferenceError: foo is not defined', source: 'app.js:3' }] : []
    }))
    watchJob('rt1', 'job-1', 'npm run dev')
    expect(await collectRuntimeEvents({ sessionKey: 'rt1', poll, includeBrowser: false })).toBe('')
    stdout += 'Error: Cannot find module "./routes"\n'
    const first = await collectRuntimeEvents({ sessionKey: 'rt1', browserOwner: 'session:rt1', poll, runtime, includeBrowser: true })
    expect(first).toContain('<runtime_events>')
    expect(first).toContain('job job-1 (npm run dev): Error: Cannot find module "./routes"')
    expect(first).toContain('page exception: Uncaught ReferenceError: foo is not defined (app.js:3)')
    expect(await collectRuntimeEvents({ sessionKey: 'rt1', browserOwner: 'session:rt1', poll, runtime, includeBrowser: true })).toBe('')
    status = 'exited'
    expect(await collectRuntimeEvents({ sessionKey: 'rt1', poll, includeBrowser: false })).toContain('exited with code 1')
    // Exited jobs are no longer watched.
    expect(await collectRuntimeEvents({ sessionKey: 'rt1', poll, includeBrowser: false })).toBe('')
  })
})

describe('shell_wait and page events', () => {
  it('waits for a pattern, a port, or exit', async () => {
    let n = 0
    ;(window as any).api = {
      shell: {
        poll: vi.fn(async () => {
          n++
          return { status: 'running', command: 'npm run dev', stdout: n > 2 ? 'VITE ready in 200 ms\nLocal: http://localhost:5173/' : 'starting…', stderr: '', elapsedMs: n * 400 }
        })
      },
      net: { probePort: vi.fn(async () => ({ ok: true, open: n > 1 })) }
    }
    const byText = await executeTool({ id: '1', name: 'shell_wait', arguments: { job_id: 'job-1', until: 'ready in', timeout: 10 } }, '/p', undefined, { sessionId: 's' })
    expect(byText.isError).toBeFalsy()
    expect(byText.content).toMatch(/^\[running\] matched: VITE ready in 200 ms/)
    expect(byText.content).toContain('urls: http://localhost:5173/')
    n = 0
    const byPort = await executeTool({ id: '2', name: 'shell_wait', arguments: { job_id: 'job-1', port: 5173, timeout: 10 } }, '/p', undefined, { sessionId: 's' })
    expect(byPort.content).toContain('port 5173 open')
    ;(window as any).api.shell.poll = vi.fn(async () => ({ status: 'exited', exitCode: 2, stdout: '', stderr: 'Error: boom', elapsedMs: 10 }))
    const exited = await executeTool({ id: '3', name: 'shell_wait', arguments: { job_id: 'job-1', until: 'never', timeout: 5 } }, '/p', undefined, { sessionId: 's' })
    expect(exited.content).toContain('exited (exit 2)')
    expect(exited.content).toContain('Error: boom')
    expect(exited.isError).toBe(true)
  }, 20_000)

  it('appends what the page reported during a browser action', async () => {
    let seq = 3
    ;(window as any).api = {
      browser: {
        runtime: vi.fn(async (_o: string, opts: { since: number }) => {
          if (opts.since === Number.MAX_SAFE_INTEGER) return { ok: true, events: [], latestSeq: seq }
          return {
            ok: true,
            latestSeq: seq,
            events: [
              { kind: 'network', level: 'error', text: 'xhr', url: 'http://localhost:3000/api/cart', status: 500, method: 'POST' },
              { kind: 'console', level: 'info', text: 'clicked' }
            ]
          }
        })
      }
    }
    const inner = vi.fn(async () => {
      seq = 5
      return { toolCallId: 'x', content: 'Clicked [3] button "Checkout"' }
    })
    const r = await withPageEvents(inner as any)({ id: 'x', name: 'browser_click', arguments: {} }, '/p', undefined, { sessionId: 's' }, (window as any).api)
    expect(r.content).toContain('[page reported 1 problem during this action]')
    expect(r.content).toContain('POST http://localhost:3000/api/cart → 500')
  })
})

describe('mentioned-file prefetch', () => {
  it('extracts path-like mentions (not URLs)', () => {
    expect(extractMentionedPaths('fix `src/app.ts` and ./lib/util.py, see https://x.com/a.ts and @web/index.tsx; also "docs/My Guide.md" Makefile')).toEqual([
      'src/app.ts',
      'docs/My Guide.md',
      './lib/util.py',
      'web/index.tsx'
    ])
    expect(extractMentionedPaths('look at the logo.png and v1.2.3')).toEqual([])
  })

  it('reads existing files inside the project roots with line numbers, bounded', async () => {
    const fs = new Map([['/p/src/app.ts', 'a\nb'], ['/other/secret.ts', 'nope']])
    const files = await prefetchMentionedFiles('update src/app.ts and src/missing.ts and /other/secret.ts', {
      roots: ['/p'],
      read: async (p) => fs.get(p) ?? null,
      isFile: async (p) => fs.has(p)
    })
    expect(files.map((f) => f.rel)).toEqual(['src/app.ts'])
    const block = formatPrefetched(files)
    expect(block).toContain('<mentioned_files>')
    expect(block).toContain('<file path="src/app.ts" lines="1-2">\n     1\ta\n     2\tb\n</file>')
  })
})

describe('repo profile', () => {
  beforeEach(() => _resetProfileCache())
  it('classifies commands', () => {
    expect(classifyCommand('npx vitest run src/a.test.ts')).toBe('test')
    expect(classifyCommand('pnpm run typecheck')).toBe('typecheck')
    expect(classifyCommand('npx tsc --noEmit -p tsconfig.web.json')).toBe('typecheck')
    expect(classifyCommand('ruff check .')).toBe('lint')
    expect(classifyCommand('pnpm install')).toBe('install')
    expect(classifyCommand('npm run build')).toBe('build')
    expect(classifyCommand('ls -la')).toBeNull()
  })

  it('detects the stack and commands, learns verified commands, and persists', async () => {
    const files = new Map<string, string>([
      ['/r/package.json', JSON.stringify({ type: 'module', scripts: { dev: 'vite', test: 'vitest run', typecheck: 'tsc --noEmit' }, devDependencies: { typescript: '5', vitest: '1', react: '19' } })],
      ['/r/pnpm-lock.yaml', ''],
      ['/r/tsconfig.json', '{}'],
      ['/r/CLAUDE.md', '#']
    ])
    const saved: Record<string, string> = {}
    ;(window as any).api = {
      fs: { readFile: async (p: string) => files.get(p) ?? { error: 'ENOENT' }, exists: async (p: string) => files.has(p) },
      profile: { get: async (r: string) => ({ ok: true, json: saved[r] ?? null }), save: async (r: string, j: string) => ((saved[r] = j), { ok: true }) }
    }
    const p = await detectProfile('/r')
    expect(p.stack).toEqual(['TypeScript', 'React', 'Vitest'])
    expect(p.packageManager).toBe('pnpm')
    expect(p.commands.test?.command).toBe('pnpm run test')
    expect(p.commands.dev?.command).toBe('pnpm run dev')
    expect(p.conventions).toContain('CLAUDE.md has project instructions')
    await loadProfile('/r')
    learnFromCommand('/r', 'pnpm run test', { exitCode: 0, durationMs: 12_000 })
    learnFromCommand('/r', 'npx vitest run src/only.test.ts', { exitCode: 0 }) // scoped → not adopted
    learnFromCommand('/r', 'pnpm run typecheck', { exitCode: 2 })
    learnFromCommand('/r', 'ruff check .', { exitCode: 0 })
    const prof = await loadProfile('/r')
    expect(prof!.commands.test).toMatchObject({ command: 'pnpm run test', verified: true, durationMs: 12_000 })
    expect(prof!.commands.typecheck).toMatchObject({ failures: 1 })
    expect(prof!.commands.lint).toMatchObject({ command: 'ruff check .', source: 'learned', verified: true })
    const block = formatProfileBlock(prof!)
    expect(block).toContain('test: `pnpm run test` ✓ ~12s')
    expect(block).toContain('Stack: TypeScript, React, Vitest · package manager: pnpm')
    await new Promise((r) => setTimeout(r, 1700))
    expect(JSON.parse(saved['/r']).commands.test.verified).toBe(true)
    // Project profile tool: add a note, view.
    const r = await executeTool({ id: '1', name: 'project_profile', arguments: { action: 'add_note', note: 'Run vitest with --pool=forks (native addon)' } }, '/r', undefined, { sessionId: 's' })
    expect(r.content).toContain('0: Run vitest with --pool=forks (native addon)')
  })
})

describe('correction learning', () => {
  it('recognizes corrections in four languages, not ordinary follow-ups', () => {
    const ctx = { hadAgentTurn: true }
    for (const t of ['No, use pnpm instead of npm', "Don't touch the generated files", '아니 그게 아니라 pnpm 써', '그거 말고 기존 함수 재사용해', '違う、pnpm を使って', '不对，不要改这个文件']) {
      expect(detectCorrection(t, ctx), t).not.toBeNull()
    }
    for (const t of ['Thanks! Now add a test', 'Can you also update the README?', '좋아요, 이제 커밋해줘']) expect(detectCorrection(t, ctx), t).toBeNull()
    expect(detectCorrection('no', { hadAgentTurn: false })).toBeNull()
    expect(detectCorrection('please redo it with hooks', { hadAgentTurn: true, reverted: true })?.reason).toBe('revert')
  })

  it('tracks reverts and saves a project lesson (heuristic without a model)', async () => {
    noteRevert('s9', ['/p/a.ts'])
    expect(takeRecentRevert('s9')).toEqual({ files: ['/p/a.ts'] })
    expect(takeRecentRevert('s9')).toBeNull()
    const save = vi.fn(async () => ({ ok: true }))
    ;(window as any).api = { memory: { save } }
    const r = await learnFromCorrection({ sessionId: 's', projectId: 'p1', correction: 'Never edit dist/ — change src/ and rebuild', previousRequest: 'fix the button', useModel: false })
    expect(r?.saved).toBe(true)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'procedure', scope: 'project', projectId: 'p1', tags: ['correction', 'lesson'], source: 'auto' }))
    expect(heuristicLesson({ correction: 'use pnpm', reverted: true, files: ['a.ts'] })).toContain("reverted the agent's changes to a.ts")
  })
})

describe('streaming tool dispatch', () => {
  function sseStream(chunks: string[], onPull: (i: number) => void): ReadableStream<Uint8Array> {
    let i = 0
    const enc = new TextEncoder()
    return new ReadableStream({
      pull(controller) {
        onPull(i)
        if (i >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(enc.encode(chunks[i++]))
      }
    })
  }

  const decision = (apiFormat: string) =>
    ({
      provider: { id: 'p', name: 'P', apiFormat, baseUrl: 'http://fake', apiKey: 'k', enabled: true },
      model: { id: 'p:m', providerId: 'p', modelId: apiFormat === 'claude' ? 'claude-x' : 'fake-model', label: 'M', tier: 'mid', enabled: true },
      key: 'p:m',
      tier: 'mid',
      reason: 'test'
    }) as any

  it('hands each Claude tool call over as soon as its block closes', async () => {
    const seen: string[] = []
    const atPull: number[] = []
    const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
    const chunks = [
      ev({ type: 'message_start', message: { usage: { input_tokens: 10 } } }),
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'read_file' } }),
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' } }),
      ev({ type: 'content_block_stop', index: 0 }),
      ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't2', name: 'read_file' } }),
      ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"b.ts"}' } }),
      ev({ type: 'content_block_stop', index: 1 }),
      ev({ type: 'message_delta', usage: { output_tokens: 5 } })
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseStream(chunks, (i) => atPull.push(seen.length * 100 + i)))))
    ;(window as any).api = { platform: 'darwin' }
    const res = await callLLM({
      decision: decision('claude'),
      entries: [{ role: 'user', content: 'hi' }],
      systemLayers: ['sys'],
      projectPreamble: '',
      sessionId: 's',
      projectId: 'p',
      assistantMsgId: 'm',
      signal: new AbortController().signal,
      onToolCall: (c: ToolCall) => seen.push(c.id)
    })
    vi.unstubAllGlobals()
    expect(res.toolCalls.map((c) => c.id)).toEqual(['t1', 't2'])
    expect(seen).toEqual(['t1', 't2'])
    // t1 was dispatched while t2 was still streaming: when the chunk closing
    // t2's block was pulled, exactly one call had been handed over.
    expect(atPull).toContain(106)
  })

  it('hands OpenAI tool calls over as soon as their arguments are complete JSON', async () => {
    const seen: Array<{ id: string; args: unknown }> = []
    const d = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
    const chunks = [
      d({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c0', function: { name: 'grep_search', arguments: '{"query":' } }] } }] }),
      d({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"foo"}' } }] } }] }),
      d({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'c1', function: { name: 'read_file', arguments: '{"path":"x"}' } }] } }] }),
      d({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n'
    ]
    let seenAtThird = -1
    // Pull #4 happens once chunks 0-2 were processed (index 1 started, finish not yet seen).
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseStream(chunks, (i) => { if (i === 4) seenAtThird = seen.length }))))
    ;(window as any).api = { platform: 'darwin' }
    await callLLM({
      decision: decision('openai'),
      entries: [{ role: 'user', content: 'hi' }],
      systemLayers: ['sys'],
      projectPreamble: '',
      sessionId: 's',
      projectId: 'p',
      assistantMsgId: 'm',
      signal: new AbortController().signal,
      onToolCall: (c: ToolCall) => seen.push({ id: c.id, args: c.arguments })
    })
    vi.unstubAllGlobals()
    // Both calls were handed over before the finish chunk was processed; the
    // first only once its split arguments formed a complete JSON object.
    expect(seenAtThird).toBe(2)
    expect(seen).toEqual([
      { id: 'c0', args: { query: 'foo' } },
      { id: 'c1', args: { path: 'x' } }
    ])
  })
})
