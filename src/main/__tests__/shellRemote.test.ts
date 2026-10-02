import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let sshDir = join(tmpdir(), 'pawn-shell-remote-test')

vi.mock('electron', () => {
  const store = new Map<string, string>()
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => {
        const id = `k${store.size}`
        store.set(id, s)
        return Buffer.from(id, 'utf8')
      },
      decryptString: (buf: Buffer) => {
        const v = store.get(buf.toString('utf8'))
        if (v == null) throw new Error('unknown')
        return v
      }
    },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    shell: { openPath: vi.fn(async () => '') }
  }
})

vi.mock('../window', () => ({ getMainWindow: () => null, getHeadlessWindow: () => null, isAppUrl: () => true }))
vi.mock('../config', () => ({
  getPawnDir: () => sshDir,
  shellPolicyFloor: () => ({ sandbox: true, network: true, jail: true })
}))

const spawned: Array<{ file: string; args: string[]; opts?: { cwd?: string; env?: Record<string, string> } }> = []

vi.mock('child_process', () => ({
  spawn: vi.fn((file: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => {
    spawned.push({ file, args, opts })
    const fake = {
      stdout: { setEncoding: () => {}, on: () => {} },
      stderr: { setEncoding: () => {}, on: () => {} },
      on: (ev: string, cb: (a?: unknown, b?: unknown) => void) => {
        if (ev === 'close') setTimeout(() => cb(0, null), 0)
      },
      killed: false,
      exitCode: null,
      pid: 4242,
      kill: () => true
    }
    return fake
  }),
  execFile: vi.fn(),
  spawnSync: vi.fn((cmd: string, args: string[]) =>
    args[0] === 'sshpass' ? { status: 0 } : { status: 1 }
  )
}))

import { runShellCommand, startBackgroundJob } from '../ipc/shell'
import { addHost } from '../ssh'

function addTestHost(): string {
  const res = addHost({ label: 'lab', host: 'box.tailnet-ts.net', user: 'root', auth: 'key' })
  if (!res.ok) throw new Error(res.error)
  return res.host.id
}

afterEach(() => {
  rmSync(sshDir, { recursive: true, force: true })
  sshDir = join(tmpdir(), 'pawn-shell-remote-test')
  spawned.length = 0
})

describe('shell remote routing', () => {
  it('local target keeps the plain shell spawn (no ssh argv)', async () => {
    const res = await runShellCommand('echo hi', '/tmp', 10_000)
    expect(res.exitCode).toBe(0)
    expect(spawned[0].file).not.toBe('ssh')
    expect(JSON.stringify(spawned[0].args)).not.toContain('ssh')
    expect(res.host).toBeUndefined()
  })

  it('hostId spawns through ssh with cd-wrapped command and tags the result', async () => {
    const hostId = addTestHost()
    const res = await runShellCommand('npm test', '/srv/app', 10_000, { hostId })
    expect(res.exitCode).toBe(0)
    expect(res.host).toBe(hostId)
    const last = spawned[spawned.length - 1]
    expect(last.file).toBe('ssh')
    expect(last.args[last.args.length - 1]).toBe("cd '/srv/app' && npm test")
    expect(last.args).toContain('root@box.tailnet-ts.net')
    // SSHPASS never lands in argv for key auth
    expect(JSON.stringify(last.args)).not.toContain('SSHPASS')
  })

  it('rejects an unconfigured hostId before spawning anything', async () => {
    const res = await runShellCommand('echo hi', '/tmp', 10_000, { hostId: 'ghost-host' })
    expect(res.exitCode).toBe(126)
    expect(res.stderr).toContain('Unknown SSH execution host')
    expect(spawned).toHaveLength(0)
  })

  it('still blocks dangerous commands on the remote path', async () => {
    const hostId = addTestHost()
    const res = await runShellCommand('sudo rm -rf /', '/tmp', 10_000, { hostId })
    expect(res.exitCode).toBe(126)
    expect(res.sandboxNote).toBe('blocked')
    expect(spawned).toHaveLength(0)
  })

  it('background jobs route through ssh too', async () => {
    const hostId = addTestHost()
    const started = startBackgroundJob('npm run dev', '/srv/app', { hostId })
    expect(started.error).toBeUndefined()
    const last = spawned[spawned.length - 1]
    expect(last.file).toBe('ssh')
    expect(last.args[last.args.length - 1]).toBe("cd '/srv/app' && npm run dev")
  })

  it('password hosts merge SSHPASS into a FULL environment (PATH must survive)', async () => {
    // Password auth ships the secret via SSHPASS env — but the child still
    // needs PATH to find sshpass/ssh at all (regression: env was replaced,
    // not merged, so the spawn failed with ENOENT).
    const added = addHost({ label: 'pw', host: 'plain.example.com', user: 'ops', auth: 'password', password: 'hunter2' })
    if (!added.ok) throw new Error(added.error)
    const res = await runShellCommand('uptime', '/srv', 10_000, { hostId: added.host.id })
    expect(res.exitCode).toBe(0)
    const last = spawned[spawned.length - 1]
    expect(last.file).toBe('sshpass')
    expect(JSON.stringify(last.args)).not.toContain('hunter2')
    expect(last.opts?.env?.SSHPASS).toBe('hunter2')
    expect(last.opts?.env?.PATH).toBe(process.env.PATH)
    expect(res.host).toBe(added.host.id)
  })
})
