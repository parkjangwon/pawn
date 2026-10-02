import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let sshDir = join(tmpdir(), 'pawn-bash-remote-test')

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
    ipcMain: { handle: vi.fn(), on: vi.fn() }
  }
})

vi.mock('../config', () => ({
  getPawnDir: () => sshDir,
  shellPolicyFloor: () => ({ sandbox: true, network: true, jail: true })
}))

interface FakeProc {
  file: string
  args: string[]
  stdinWrites: string[]
  onData: ((chunk: Buffer) => void) | null
}

const fakes: FakeProc[] = []

vi.mock('child_process', () => ({
  spawn: vi.fn((file: string, args: string[]) => {
    const fake: FakeProc = { file, args, stdinWrites: [], onData: null }
    fakes.push(fake)
    const proc = {
      stdin: {
        write: (line: string) => {
          fake.stdinWrites.push(line)
          // Simulate the remote shell: decode the b64 body if present, echo it
          // as output, then answer with the sentinel carrying exit code + PWD.
          const nonce = /__PAWN_DONE_([a-f0-9]+)_/.exec(line)?.[1]
          if (nonce && fake.onData) {
            const b64 = /printf %s '([^']+)' \| base64 -d/.exec(line)?.[1]
            const decoded = b64 ? Buffer.from(b64, 'base64').toString('utf8') : ''
            setImmediate(() => {
              fake.onData!(
                Buffer.from(`${decoded}\n__PAWN_DONE_${nonce}_0_/srv/app\n`)
              )
            })
          }
        }
      },
      stdout: {
        setEncoding: () => {},
        on: (_ev: string, cb: (chunk: Buffer) => void) => {
          fake.onData = cb
        }
      },
      stderr: { setEncoding: () => {}, on: () => {} },
      on: () => {},
      killed: false,
      exitCode: 0,
      pid: 777
    }
    return proc
  })
}))

import { BashSession } from '../bashSession'
import { addHost } from '../ssh'

afterEach(() => {
  rmSync(sshDir, { recursive: true, force: true })
  sshDir = join(tmpdir(), 'pawn-bash-remote-test')
  fakes.length = 0
})

describe('remote bash session (sentinel protocol over ssh)', () => {
  it('ships the command base64+eval over the wire — never the local tmp path', async () => {
    const added = addHost({ label: 'lab', host: 'box.tailnet-ts.net', user: 'root', auth: 'key' })
    if (!added.ok) throw new Error(added.error)

    const session = new BashSession({
      cwd: '/srv/app',
      sandbox: { enabled: true, hostId: added.host.id }
    })
    const r = await session.run('echo remote-hello', { timeoutMs: 5000 })

    // The local process is ssh, not bash.
    expect(fakes[0].file).toBe('ssh')
    // The command must arrive decoded by the remote shell (the fake above ran
    // the decoded body) — proving the wire protocol executes the real command.
    expect(r.output).toContain('remote-hello')
    expect(r.exitCode).toBe(0)
    // PWD tracking comes from the remote sentinel.
    expect(r.cwd).toBe('/srv/app')

    const protocolLine = fakes[0].stdinWrites.join('')
    // Wire carries base64, not the plaintext command or a local tmp path…
    expect(protocolLine).toContain('base64 -d')
    expect(protocolLine).not.toContain('echo remote-hello')
    expect(protocolLine).not.toContain('/var/folders')
    expect(protocolLine).not.toContain('. /')
    // The remote bash is seeded into the session cwd (spawn args), since the
    // channel itself has no local cwd.
    const spawnArgs = fakes[0].args
    expect(spawnArgs[spawnArgs.length - 1]).toContain("cd '/srv/app' && exec bash --noprofile --norc")
  })
})
