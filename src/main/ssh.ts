/**
 * SSH remote-execution targets. Hosts live in ~/.pawn/ssh.json (0600); the
 * password, when the user opts into password auth, is sealed with safeStorage
 * and only ever handed to sshpass through the SSHPASS environment variable —
 * never argv, never the renderer. Transport is the system ssh client, so the
 * user's ~/.ssh/config, agent, hardware keys, and Tailscale MagicDNS
 * hostnames all work unchanged.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFile, spawnSync } from 'child_process'
import { decryptApiKey, encryptApiKey } from './providerSecrets'
import { getPawnDir } from './config'

const HOST_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i
const HOSTNAME = /^[A-Za-z0-9._-]{1,253}$/
const USER_RE = /^[a-z_][a-z0-9._-]{0,31}$/i
const ALPHANUM = /^[A-Za-z0-9_]+$/

export interface SshHost {
  id: string
  label: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  /** Sealed at rest (enc:v1); never leaves the main process. */
  password?: string
  auth: 'key' | 'password'
  createdAt: number
}

export interface SshHostView extends Omit<SshHost, 'password'> {
  hasPassword: boolean
}

interface SshStore {
  hosts: SshHost[]
}

function sshDir(): string {
  return join(getPawnDir(), 'ssh')
}

function sshStorePath(): string {
  return join(sshDir(), 'hosts.json')
}

function controlPathDir(): string {
  return join(sshDir(), 'cm')
}

function ensureDirs(): void {
  for (const dir of [sshDir(), controlPathDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
      chmodSync(dir, 0o700)
    } catch {
      /* Windows */
    }
  }
}

function clip(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\u0000-\u001f]/g, '').trim()
  return s ? s.slice(0, max) : undefined
}

function asHost(raw: unknown): SshHost | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !HOST_ID.test(o.id)) return null
  if (typeof o.host !== 'string' || !HOSTNAME.test(o.host)) return null
  if (typeof o.user === 'string' && o.user && !USER_RE.test(o.user)) return null
  if (o.port !== undefined && (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535)) return null
  const auth = o.auth === 'password' ? 'password' : 'key'
  const password = typeof o.password === 'string' ? decryptApiKey(o.password) : undefined
  return {
    id: o.id,
    label: clip(o.label, 60) || o.host,
    host: o.host,
    user: clip(o.user, 32),
    port: typeof o.port === 'number' ? o.port : undefined,
    identityFile: clip(o.identityFile, 300),
    password: password || undefined,
    auth,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0
  }
}

function loadStore(): SshStore {
  ensureDirs()
  if (!existsSync(sshStorePath())) return { hosts: [] }
  try {
    const raw = JSON.parse(readFileSync(sshStorePath(), 'utf8')) as { hosts?: unknown }
    const hosts = Array.isArray(raw.hosts) ? raw.hosts.map(asHost).filter((h): h is SshHost => !!h) : []
    return { hosts }
  } catch {
    return { hosts: [] }
  }
}

function saveStore(store: SshStore): void {
  ensureDirs()
  const sealed = {
    hosts: store.hosts.map((h) => ({
      ...h,
      password: h.password ? encryptApiKey(h.password) : undefined
    }))
  }
  writeFileSync(sshStorePath(), JSON.stringify(sealed, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(sshStorePath(), 0o600)
  } catch {
    /* Windows */
  }
}

export function listHosts(): SshHostView[] {
  return loadStore().hosts.map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password }))
}

/** Main-side source of truth: an execution request is only honored for a configured host. */
export function resolveHost(hostId: unknown): SshHost | null {
  if (typeof hostId !== 'string' || !HOST_ID.test(hostId)) return null
  return loadStore().hosts.find((h) => h.id === hostId) ?? null
}

export function addHost(input: unknown): { ok: true; host: SshHostView } | { ok: false; error: string } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const label = clip(o.label, 60)
  const hostName = clip(o.host, 253)
  if (!hostName || !HOSTNAME.test(hostName)) return { ok: false, error: 'A valid hostname is required' }
  const user = clip(o.user, 32)
  if (user && !USER_RE.test(user)) return { ok: false, error: 'Invalid user name' }
  const port = typeof o.port === 'number' && Number.isInteger(o.port) && o.port >= 1 && o.port <= 65535 ? o.port : undefined
  const identityFile = clip(o.identityFile, 300)
  const auth = o.auth === 'password' ? 'password' : 'key'
  const password = clip(o.password, 500)
  if (auth === 'password' && !password) return { ok: false, error: 'A password is required for password auth' }
  if (auth === 'password' && !sshPassAvailable()) {
    return { ok: false, error: 'sshpass is required for password auth. Install it (macOS: brew install sshpass, Debian/Ubuntu: apt install sshpass) or use key auth.' }
  }

  const store = loadStore()
  const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const host: SshHost = {
    id: ALPHANUM.test(id) ? id : `h${store.hosts.length + 1}`,
    label: label || hostName,
    host: hostName,
    user: user || undefined,
    port,
    identityFile: identityFile || undefined,
    password: auth === 'password' ? password : undefined,
    auth,
    createdAt: Date.now()
  }
  store.hosts.push(host)
  saveStore(store)
  const { password: _drop, ...view } = host
  return { ok: true, host: { ...view, hasPassword: !!host.password } as SshHostView }
}

export function removeHost(hostId: unknown): { ok: boolean; error?: string } {
  if (typeof hostId !== 'string') return { ok: false, error: 'Invalid host id' }
  const store = loadStore()
  const before = store.hosts.length
  store.hosts = store.hosts.filter((h) => h.id !== hostId)
  if (store.hosts.length === before) return { ok: false, error: 'Host not found' }
  saveStore(store)
  return { ok: true }
}

/** Is the sshpass helper present? Required only for password-auth hosts. */
export function sshPassAvailable(): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const res = spawnSync(cmd, ['sshpass'], { timeout: 5000 })
  return res.status === 0
}

/** user@host destination string (no shell quoting needed — validated charset). */
export function destinationOf(host: SshHost): string {
  return host.user ? `${host.user}@${host.host}` : host.host
}

export interface RemoteSpawnPlan {
  /** Executable: 'sshpass' when password auth, else 'ssh'. */
  file: string
  args: string[]
  /** Extra env for the child (SSHPASS for password auth). Merge over process.env. */
  env?: Record<string, string>
}

/** POSIX single-quote so a value cannot break out of a (remote) shell word. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Build the argv that spawns `command` on `host`. The dangerous-command
 * denylist and cwd jail run in the caller BEFORE this — the remote wrap adds
 * no new authorization, only transport.
 */
export function buildRemoteSpawn(
  host: SshHost,
  command: string,
  opts?: { cwd?: string }
): RemoteSpawnPlan {
  ensureDirs()
  const control = `${controlPathDir()}/cm-%r@%h:%p`
  const sshArgs = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `ControlMaster=auto`,
    '-o', `ControlPath=${control}`,
    '-o', 'ControlPersist=10m',
    '-o', 'ServerAliveInterval=30'
  ]
  if (host.port && host.port !== 22) sshArgs.push('-p', String(host.port))
  if (host.identityFile) sshArgs.push('-i', host.identityFile)
  sshArgs.push(destinationOf(host), '--')
  const remote = opts?.cwd ? `cd ${shq(opts.cwd)} && ${command}` : command
  if (host.auth === 'password' && host.password) {
    return {
      file: 'sshpass',
      args: ['-e', 'ssh', ...sshArgs, remote],
      env: { SSHPASS: host.password }
    }
  }
  return { file: 'ssh', args: [...sshArgs, '-o', 'BatchMode=yes', remote] }
}

/** Persistent-session variant: an interactive-less remote bash for BashSession. */
export function buildRemoteShellArgs(host: SshHost): RemoteSpawnPlan {
  const plan = buildRemoteSpawn(host, 'exec bash --noprofile --norc')
  return plan
}

/** Settings "test connection": run uname -sr remotely and report. */
export function testConnection(hostId: string, timeoutMs = 15_000): Promise<{ ok: boolean; error?: string; uname?: string }> {
  const host = resolveHost(hostId)
  if (!host) return Promise.resolve({ ok: false, error: 'Host not found' })
  const plan = buildRemoteSpawn(host, 'printf __pawn_ok__ && uname -sr')
  return new Promise((resolve) => {
    const child = execFile(
      plan.file,
      plan.args,
      { timeout: timeoutMs, env: plan.env ? { ...process.env, ...plan.env } : process.env },
      (err, stdout, stderr) => {
        const out = stdout.toString()
        if (err || !out.includes('__pawn_ok__')) {
          const message = err?.message || stderr.toString() || 'Connection failed'
          resolve({ ok: false, error: message.slice(0, 300) })
          return
        }
        resolve({ ok: true, uname: out.replace('__pawn_ok__', '').trim() })
      }
    )
    child.on('error', () => {
      /* handled by the execFile callback */
    })
  })
}
