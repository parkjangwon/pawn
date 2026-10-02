import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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
    }
  }
})

let sshDir = join(tmpdir(), 'pawn-ssh-test')

vi.mock('../config', () => ({ getPawnDir: () => sshDir }))

import {
  addHost,
  buildRemoteSpawn,
  buildRemoteShellArgs,
  destinationOf,
  listHosts,
  resolveHost,
  sshPassAvailable
} from '../ssh'

afterEach(() => {
  rmSync(sshDir, { recursive: true, force: true })
  sshDir = join(tmpdir(), 'pawn-ssh-test')
})

const HOST_INPUT = {
  label: 'homelab',
  host: 'box.tailnet-ts.net',
  user: 'root',
  port: 2222,
  auth: 'key' as const
}

describe('ssh host store', () => {
  it('adds, lists, resolves, and removes hosts with the password sealed at rest', async () => {
    const keyHost = addHost(HOST_INPUT)
    expect(keyHost.ok).toBe(true)
    const pwHost = addHost({ ...HOST_INPUT, label: 'pw', host: 'other.example.com', auth: 'password', password: 'hunter2' })
    expect(pwHost.ok).toBe(true)

    const list = listHosts()
    expect(list).toHaveLength(2)
    expect(JSON.stringify(list)).not.toContain('hunter2')
    expect(list.find((h) => h.auth === 'password')?.hasPassword).toBe(true)

    const id = list[0].id
    expect(resolveHost(id)?.host).toBe(list[0].host)
    expect(resolveHost('nope')).toBeNull()

    // The password is encrypted on disk (safeStorage prefix), file is 0600.
    const raw = readFileSync(join(sshDir, 'ssh', 'hosts.json'), 'utf8')
    expect(raw).toContain('enc:v1:')
    expect(raw).not.toContain('hunter2')
    expect(statSync(join(sshDir, 'ssh', 'hosts.json')).mode & 0o777).toBe(0o600)

    const removed = await import('../ssh').then((m) => m.removeHost(id))
    expect(removed.ok).toBe(true)
    expect(listHosts()).toHaveLength(1)
  })

  it('rejects invalid input and password auth without sshpass', () => {
    expect(addHost({ host: '' }).ok).toBe(false)
    expect(addHost({ host: 'ok host; rm -rf' }).ok).toBe(false)
    expect(addHost({ host: 'fine.example.com', auth: 'password' }).ok).toBe(false)
  })

  it('sshPassAvailable probes the PATH without throwing', () => {
    expect(typeof sshPassAvailable()).toBe('boolean')
  })
})

describe('remote spawn builder', () => {
  it('key-auth hosts run ssh with ControlMaster, destination, and the quoted command', () => {
    const added = addHost(HOST_INPUT)
    if (!added.ok) throw new Error('host add failed')
    const host = resolveHost(added.host.id)!
    const plan = buildRemoteSpawn(host, 'npm test', { cwd: '/srv/app' })
    expect(plan.file).toBe('ssh')
    expect(plan.env).toBeUndefined()
    const args = plan.args
    expect(args).toContain('ControlMaster=auto')
    expect(args.some((a) => a.startsWith('ControlPath='))).toBe(true)
    expect(args).toContain('-p')
    expect(args).toContain('2222')
    expect(args).toContain('root@box.tailnet-ts.net')
    // cd wraps the command, single-quoted
    expect(args[args.length - 1]).toBe(`cd '/srv/app' && npm test`)
    expect(destinationOf(host)).toBe('root@box.tailnet-ts.net')
  })

  it('password hosts prepend sshpass -e and carry SSHPASS out of argv', () => {
    const added = addHost({ host: 'plain.example.com', auth: 'password', password: 'hunter2' })
    if (!added.ok) throw new Error(added.ok ? '' : added.error)
    const host = resolveHost(added.host.id)!
    vi.mock('child_process', () => ({ spawnSync: () => ({ status: 0 }) }))
    const plan = buildRemoteSpawn(host, 'uptime')
    if (plan.file !== 'sshpass') {
      // sshpass absent on this machine: the builder still must not leak argv.
      expect(JSON.stringify(plan.args)).not.toContain('hunter2')
      return
    }
    expect(plan.args).toEqual(['-e', 'ssh', ...plan.args.slice(2)])
    expect(JSON.stringify(plan.args)).not.toContain('hunter2')
    expect(plan.env?.SSHPASS).toBe('hunter2')
    vi.doUnmock('child_process')
  })

  it('persistent shell sessions get a remote bash with the sentinel-safe protocol', () => {
    const added = addHost(HOST_INPUT)
    if (!added.ok) throw new Error('host add failed')
    const host = resolveHost(added.host.id)!
    const plan = buildRemoteShellArgs(host)
    expect(plan.file).toBe('ssh')
    expect(plan.args[plan.args.length - 1]).toBe("exec bash --noprofile --norc")
  })
})
