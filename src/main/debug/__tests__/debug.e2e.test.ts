import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DebugManager } from '../manager'
import { resolveLldbAdapter, resolvePythonAdapter } from '../adapters'

const TIMEOUT = 60000

function commandExists(cmd: string): boolean {
  const res = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' })
  return res.status === 0 && Boolean((res.stdout || '').trim())
}

function lldbAvailable(): boolean {
  try {
    resolveLldbAdapter({ sessionKey: 't', program: '/x', cwd: '/tmp' })
    return commandExists('cc')
  } catch {
    return false
  }
}

function debugpyAvailable(): boolean {
  try {
    resolvePythonAdapter({ sessionKey: 't', program: '/x', cwd: '/tmp' })
    return true
  } catch {
    return false
  }
}

// --------------------------------------------------------------------------
// Node (CDP) — real end-to-end
// --------------------------------------------------------------------------

describe('Node debugger (CDP)', () => {
  let dir: string
  let manager: DebugManager

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pawn-dbg-node-'))
    manager = new DebugManager()
  })

  afterEach(async () => {
    await manager.stopAll()
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it(
    'stops at a breakpoint, inspects locals, evaluates, steps, and runs to exit',
    async () => {
      const file = join(dir, 'sum.js')
      const lines = [
        'function computeTotal(items) {', // 1
        '  let total = 0', // 2
        '  for (let i = 0; i < items.length; i++) {', // 3
        '    const value = items[i]', // 4
        '    total = total + value', // 5  <-- breakpoint
        '  }', // 6
        '  return total', // 7
        '}', // 8
        'const result = computeTotal([10, 20, 30])', // 9
        'console.log("RESULT=" + result)' // 10
      ]
      writeFileSync(file, lines.join('\n') + '\n')

      const state = await manager.start({
        sessionKey: 'node1',
        language: 'node',
        program: file,
        cwd: dir,
        breakpoints: [{ path: file, line: 5 }]
      })

      expect(state.status).toBe('stopped')
      expect(state.reason).toBe('breakpoint')
      expect(state.location?.line).toBe(5)
      const localNames = (state.locals ?? []).map((l) => l.name)
      // `total` is function-local; `value` is loop/block-local — both surfaced.
      expect(localNames).toContain('total')
      expect(localNames).toContain('value')
      const value = state.locals?.find((l) => l.name === 'value')
      expect(value?.value).toBe('10')

      // Evaluate an expression in the paused frame.
      const evalRes = await manager.evaluate('node1', 'items.length')
      expect(evalRes.error).toBeUndefined()
      expect(evalRes.result).toBe('3')

      // Step over: line should advance to 6 (loop closing brace) or stay in loop.
      const afterStep = await manager.step('node1', 'over')
      expect(afterStep.status).toBe('stopped')
      expect(afterStep.location?.line).not.toBe(5)

      // Clear the breakpoint, then continue to termination.
      await manager.setBreakpoints('node1', file, [])
      const final = await manager.continue('node1')
      expect(final.status).toBe('terminated')
      expect(final.exitCode).toBe(0)
      expect(final.output).toContain('RESULT=60')
    },
    TIMEOUT
  )

  it(
    'pauses on an uncaught exception with a message',
    async () => {
      const file = join(dir, 'boom.js')
      writeFileSync(
        file,
        ['function boom() {', '  throw new Error("kaboom")', '}', 'boom()', ''].join('\n')
      )
      const state = await manager.start({
        sessionKey: 'node2',
        language: 'node',
        program: file,
        cwd: dir
      })
      expect(state.status).toBe('stopped')
      expect(state.reason).toBe('exception')
      expect(state.exception ?? '').toContain('kaboom')
    },
    TIMEOUT
  )
})

// --------------------------------------------------------------------------
// lldb-dap — real end-to-end (skipped when lldb-dap or cc is missing)
// --------------------------------------------------------------------------

const lldbDescribe = lldbAvailable() ? describe : describe.skip

// Known environment quirk: on machines whose lldb-dap comes from Xcode, the
// "stops in a function" scenario can hang (adapter never reports stopped) and
// time out at the 19s guard. The first breakpoint scenario passes on the same
// machine, so the adapter wiring itself is fine — treat a failure here as
// environment-dependent before assuming a product regression.
lldbDescribe('C debugger (lldb-dap)', () => {
  let dir: string
  let manager: DebugManager
  let exe: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pawn-dbg-c-'))
    manager = new DebugManager()
    const src = join(dir, 'prog.c')
    writeFileSync(
      src,
      [
        '#include <stdio.h>',
        'int add(int a, int b) {',
        '  int sum = a + b;', // line 3 <-- breakpoint
        '  return sum;',
        '}',
        'int main() {',
        '  int r = add(2, 40);',
        '  printf("R=%d\\n", r);',
        '  return 0;',
        '}',
        ''
      ].join('\n')
    )
    exe = join(dir, 'prog')
    const cc = spawnSync('cc', ['-g', '-O0', '-o', exe, src], { encoding: 'utf8' })
    if (cc.status !== 0) throw new Error(`cc failed: ${cc.stderr}`)
  })

  afterEach(async () => {
    await manager.stopAll()
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it(
    'stops in a function, reads locals, evaluates, continues to exit',
    async () => {
      const src = join(dir, 'prog.c')
      const state = await manager.start({
        sessionKey: 'c1',
        language: 'lldb',
        program: exe,
        cwd: dir,
        breakpoints: [{ path: src, line: 3 }]
      })
      expect(state.status).toBe('stopped')
      const names = (state.locals ?? []).map((l) => l.name)
      // a and b are the parameters visible at the breakpoint.
      expect(names.some((n) => n === 'a' || n === 'b' || n === 'sum')).toBe(true)

      const evalRes = await manager.evaluate('c1', 'a + b')
      // lldb evaluate returns "42" (value may include type formatting).
      expect(evalRes.error === undefined ? evalRes.result : '').toMatch(/42/)

      await manager.setBreakpoints('c1', src, [])
      const final = await manager.continue('c1')
      expect(['terminated', 'running']).toContain(final.status)
    },
    TIMEOUT
  )
})

// --------------------------------------------------------------------------
// python/debugpy — the adapter is expected to be missing on this machine.
// --------------------------------------------------------------------------

describe('Python debugger (debugpy) adapter resolution', () => {
  const available = debugpyAvailable()

  it('reports a clear, actionable error when debugpy is not installed', () => {
    if (available) {
      // If debugpy IS installed, resolution should succeed instead.
      expect(() =>
        resolvePythonAdapter({ sessionKey: 't', program: '/x.py', cwd: '/tmp' })
      ).not.toThrow()
      return
    }
    expect(() =>
      resolvePythonAdapter({ sessionKey: 't', program: '/x.py', cwd: '/tmp' })
    ).toThrow('debugpy is not installed: run `python3 -m pip install debugpy`')
  })

  const pyIt = available ? it : it.skip
  pyIt(
    'debugs a python script when debugpy is available',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pawn-dbg-py-'))
      const manager = new DebugManager()
      const file = join(dir, 'script.py')
      writeFileSync(file, ['def f(n):', '    x = n * 2', '    return x', 'print(f(21))', ''].join('\n'))
      try {
        const state = await manager.start({
          sessionKey: 'py1',
          language: 'python',
          program: file,
          cwd: dir,
          breakpoints: [{ path: file, line: 2 }]
        })
        expect(['stopped', 'running']).toContain(state.status)
      } finally {
        await manager.stopAll()
        rmSync(dir, { recursive: true, force: true })
      }
    },
    TIMEOUT
  )
})
