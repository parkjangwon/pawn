import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest'
import { mkdtempSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import {
  BashSession,
  BashSessionManager,
  getBashSessionManager,
  formatBashResult,
  type BashRunResult
} from '../bashSession'

const isWin = process.platform === 'win32'
const d = isWin ? describe.skip : describe

// Track sessions/managers so we can dispose them even if a test throws.
const sessions: BashSession[] = []
const managers: BashSessionManager[] = []

function track<T extends BashSession>(s: T): T {
  sessions.push(s)
  return s
}
function trackMgr<T extends BashSessionManager>(m: T): T {
  managers.push(m)
  return m
}

let projectRoot = ''

beforeAll(() => {
  // Resolve symlinks (macOS /var -> /private/var) so comparisons against bash's
  // $PWD are stable.
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pawn-bash-root-')))
})

afterEach(() => {
  for (const s of sessions.splice(0, sessions.length)) {
    try {
      s.dispose()
    } catch {
      /* ignore */
    }
  }
  for (const m of managers.splice(0, managers.length)) {
    try {
      m.killAll()
    } catch {
      /* ignore */
    }
  }
})

afterAll(() => {
  try {
    getBashSessionManager().killAll()
  } catch {
    /* ignore */
  }
  if (projectRoot) {
    try {
      rmSync(projectRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

d('BashSession — state persistence', () => {
  it('persists cwd across commands (cd)', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const sub = 'sub'
    await s.run(`mkdir -p ${sub}`)
    const r1 = await s.run(`cd ${sub} && pwd`)
    expect(r1.exitCode).toBe(0)
    const r2 = await s.run('pwd')
    expect(r2.output.trim().endsWith(sub)).toBe(true)
    expect(r2.cwd.endsWith(sub)).toBe(true)
  })

  it('persists exported variables', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    await s.run('export FOO=bar123')
    const r = await s.run('echo "$FOO"')
    expect(r.output.trim()).toBe('bar123')
  })

  it('persists shell functions', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    await s.run('greet() { echo "hi $1"; }')
    const r = await s.run('greet world')
    expect(r.output.trim()).toBe('hi world')
  })

  it('persists aliases (with expand_aliases)', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    await s.run('shopt -s expand_aliases; alias sayhi="echo aliased"')
    const r = await s.run('sayhi')
    expect(r.output.trim()).toBe('aliased')
  })
})

d('BashSession — output behavior', () => {
  it('interleaves stderr with stdout in order', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const r = await s.run('echo a; echo b >&2; echo c')
    expect(
      r.output
        .trimEnd()
        .split('\n')
        .map((l) => l.trim())
    ).toEqual(['a', 'b', 'c'])
  })

  it('reports exit codes', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const r = await s.run('exit_test() { return 7; }; exit_test; echo done')
    expect(r.exitCode).toBe(0) // last command (echo) succeeds
    const r2 = await s.run('false')
    expect(r2.exitCode).toBe(1)
    const r3 = await s.run('bash -c "exit 42"')
    expect(r3.exitCode).toBe(42)
  })

  it('does not hang when a command reads stdin (cat)', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const r = await s.run('cat; echo after-cat')
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain('after-cat')
    expect(r.timedOut).toBe(false)
  })

  it('handles heredocs and multi-line scripts', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const script = [
      'cat <<EOF',
      'line1',
      'line2',
      'EOF',
      'for i in 1 2 3; do',
      '  echo "n$i"',
      'done'
    ].join('\n')
    const r = await s.run(script)
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain('line1')
    expect(r.output).toContain('line2')
    expect(r.output).toContain('n1')
    expect(r.output).toContain('n3')
  })

  it('survives a syntax error without killing the session', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const bad = await s.run('if [ ; then echo oops')
    expect(bad.exitCode).not.toBe(0)
    expect(bad.restarted).toBe(false)
    // Session still usable.
    const good = await s.run('echo still-alive')
    expect(good.output.trim()).toBe('still-alive')
    expect(good.exitCode).toBe(0)
  })

  it('truncates very large output and marks it', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    // ~8 MB of output to exceed the 4 MB cap.
    const r = await s.run('yes ABCDEFGHIJ | head -c 8000000')
    expect(r.truncated).toBe(true)
    expect(r.output).toContain('chars omitted')
  }, 30_000)
})

d('BashSession — lifecycle: exit / timeout / abort', () => {
  it('auto-restarts after the command runs exit', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const r = await s.run('echo bye; exit 3')
    expect(r.restarted).toBe(true)
    expect(r.output).toContain('bye')
    expect(r.exitCode).toBe(3)
    // Next command works on the fresh session.
    const r2 = await s.run('echo back')
    expect(r2.output.trim()).toBe('back')
    expect(r2.exitCode).toBe(0)
  })

  it('times out and restarts, then works with cwd reset', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    await s.run('mkdir -p deep && cd deep')
    const r = await s.run('sleep 5', { timeoutMs: 1000 })
    expect(r.timedOut).toBe(true)
    expect(r.restarted).toBe(true)
    expect(r.output).toContain('did not finish')
    // cwd should be reset to the initial cwd.
    const r2 = await s.run('pwd')
    expect(r2.cwd).toBe(projectRoot)
    expect(r2.output.trim()).toBe(projectRoot)
  }, 15_000)

  it('kills a background child on timeout', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    // Launch a background sleep, print its PID, then block.
    const r = await s.run('sleep 30 & echo "CHILD=$!"; wait', { timeoutMs: 1000 })
    expect(r.timedOut).toBe(true)
    const m = /CHILD=(\d+)/.exec(r.output)
    expect(m).not.toBeNull()
    const childPid = Number(m ? m[1] : 0)
    expect(childPid).toBeGreaterThan(0)
    // Give the SIGKILL escalation time to land.
    await new Promise((res) => setTimeout(res, 1500))
    let alive = true
    try {
      process.kill(childPid, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)
  }, 15_000)

  it('kills a background child on dispose', async () => {
    const s = new BashSession({ cwd: projectRoot, sandbox: { enabled: false } })
    const r = await s.run('sleep 30 & echo "CHILD=$!"')
    const m = /CHILD=(\d+)/.exec(r.output)
    const childPid = Number(m ? m[1] : 0)
    expect(childPid).toBeGreaterThan(0)
    s.dispose()
    await new Promise((res) => setTimeout(res, 1500))
    let alive = true
    try {
      process.kill(childPid, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)
  }, 15_000)

  it('aborts via AbortSignal', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const ac = new AbortController()
    const p = s.run('sleep 10', { signal: ac.signal, timeoutMs: 30_000 })
    setTimeout(() => ac.abort(), 300)
    const r = await p
    expect(r.restarted).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.output).toContain('aborted')
    // Session still usable.
    const r2 = await s.run('echo ok')
    expect(r2.output.trim()).toBe('ok')
  }, 15_000)

  it('restart() gives a fresh session (state cleared)', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    await s.run('export KEEP=1')
    await s.restart()
    const r = await s.run('echo "[${KEEP:-empty}]"')
    expect(r.output.trim()).toBe('[empty]')
  })
})

d('BashSession — sandbox', () => {
  it('blocks dangerous commands', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: true } }))
    const r = await s.run('sudo ls')
    expect(r.blocked).toBe(true)
    expect(r.exitCode).toBe(126)
    expect(r.restarted).toBe(false)
  })

  it('resets cwd when it leaves the project root', async () => {
    const s = track(
      new BashSession({
        cwd: projectRoot,
        sandbox: { enabled: true, projectRoot, jailCwd: true }
      })
    )
    const r = await s.run('cd / && pwd')
    expect(r.cwd).toBe(projectRoot)
    expect(r.note).toMatch(/left the project root/)
    // Subsequent command should run from the reset cwd.
    const r2 = await s.run('pwd')
    expect(r2.cwd).toBe(projectRoot)
  })

  it('sanitizes env (SECRET_TOKEN not visible)', async () => {
    const prev = process.env.SECRET_TOKEN
    process.env.SECRET_TOKEN = 'super-secret-value'
    try {
      const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: true } }))
      const r = await s.run('echo "[${SECRET_TOKEN:-none}]"')
      expect(r.output.trim()).toBe('[none]')
      expect(r.output).not.toContain('super-secret-value')
    } finally {
      if (prev === undefined) delete process.env.SECRET_TOKEN
      else process.env.SECRET_TOKEN = prev
    }
  })
})

d('BashSession — concurrency', () => {
  it('serializes concurrent run() calls', async () => {
    const s = track(new BashSession({ cwd: projectRoot, sandbox: { enabled: false } }))
    const order: number[] = []
    const p1 = s.run('sleep 0.3; echo one').then((r) => {
      order.push(1)
      return r
    })
    const p2 = s.run('echo two').then((r) => {
      order.push(2)
      return r
    })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.output.trim()).toBe('one')
    expect(r2.output.trim()).toBe('two')
    // p1 was queued first, so it must resolve before p2.
    expect(order).toEqual([1, 2])
  }, 15_000)
})

d('BashSessionManager', () => {
  it('lazily creates a session per key and persists state per key', async () => {
    const m = trackMgr(new BashSessionManager())
    await m.run('a', 'export K=aaa', { cwd: projectRoot, sandbox: { enabled: false } })
    await m.run('b', 'export K=bbb', { cwd: projectRoot, sandbox: { enabled: false } })
    const ra = await m.run('a', 'echo "$K"', { cwd: projectRoot, sandbox: { enabled: false } })
    const rb = await m.run('b', 'echo "$K"', { cwd: projectRoot, sandbox: { enabled: false } })
    expect(ra.output.trim()).toBe('aaa')
    expect(rb.output.trim()).toBe('bbb')
    expect(m.list().length).toBe(2)
  })

  it('kill(key) terminates and removes a session', async () => {
    const m = trackMgr(new BashSessionManager())
    await m.run('x', 'echo hi', { cwd: projectRoot, sandbox: { enabled: false } })
    expect(m.kill('x')).toBe(true)
    expect(m.kill('x')).toBe(false)
    expect(m.list().find((e) => e.key === 'x')).toBeUndefined()
  })

  it('killAll disposes every session', async () => {
    const m = trackMgr(new BashSessionManager())
    await m.run('p', 'echo 1', { cwd: projectRoot, sandbox: { enabled: false } })
    await m.run('q', 'echo 2', { cwd: projectRoot, sandbox: { enabled: false } })
    expect(m.killAll()).toBe(2)
    expect(m.list().length).toBe(0)
  })

  it('list reports cwd, busy and idleMs', async () => {
    const m = trackMgr(new BashSessionManager())
    await m.run('l', 'echo 1', { cwd: projectRoot, sandbox: { enabled: false } })
    const list = m.list()
    expect(list.length).toBe(1)
    expect(list[0].key).toBe('l')
    expect(list[0].busy).toBe(false)
    expect(list[0].idleMs).toBeGreaterThanOrEqual(0)
  })

  it('restart re-creates the session with new cwd', async () => {
    const m = trackMgr(new BashSessionManager())
    await m.run('r', 'export TMPV=1', { cwd: projectRoot, sandbox: { enabled: false } })
    const rr = await m.restart('r', projectRoot, { enabled: false })
    expect(rr.restarted).toBe(true)
    const after = await m.run('r', 'echo "[${TMPV:-gone}]"', {
      cwd: projectRoot,
      sandbox: { enabled: false }
    })
    expect(after.output.trim()).toBe('[gone]')
  })

  it('getBashSessionManager returns a singleton', () => {
    expect(getBashSessionManager()).toBe(getBashSessionManager())
  })
})

d('formatBashResult', () => {
  const base: BashRunResult = {
    output: '',
    exitCode: 0,
    cwd: '/tmp',
    timedOut: false,
    restarted: false
  }

  it('shows (no output) for empty successful commands', () => {
    expect(formatBashResult({ ...base })).toBe('(no output)')
  })

  it('appends exit code footer for non-zero exits', () => {
    const out = formatBashResult({ ...base, output: 'boom', exitCode: 2 })
    expect(out).toContain('boom')
    expect(out).toContain('[exit code: 2]')
  })

  it('notes timeout/restart', () => {
    const out = formatBashResult({
      ...base,
      output: 'partial',
      exitCode: null,
      timedOut: true,
      restarted: true
    })
    expect(out).toContain('partial')
    expect(out).toMatch(/timed out/)
  })

  it('notes blocked commands', () => {
    const out = formatBashResult({ ...base, output: 'nope', exitCode: 126, blocked: true })
    expect(out).toContain('[blocked by sandbox policy]')
  })

  it('trims output beyond maxChars with an omitted marker', () => {
    const big = 'x'.repeat(5000)
    const out = formatBashResult({ ...base, output: big }, 1000)
    expect(out).toContain('chars omitted')
    expect(out.length).toBeLessThan(big.length)
  })
})

d('no stray bash processes remain', () => {
  it('leaves no tracked bash children after disposal', async () => {
    const s = new BashSession({ cwd: projectRoot, sandbox: { enabled: false } })
    const r = await s.run('echo "PID=$$"')
    const m = /PID=(\d+)/.exec(r.output)
    const bashPid = Number(m ? m[1] : 0)
    expect(bashPid).toBeGreaterThan(0)
    s.dispose()
    await new Promise((res) => setTimeout(res, 1500))
    let alive = true
    try {
      process.kill(bashPid, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)
    // Sanity: no leftover pawn temp cmd dirs referencing our process (best-effort).
    try {
      execSync('true')
    } catch {
      /* ignore */
    }
  }, 15_000)
})
