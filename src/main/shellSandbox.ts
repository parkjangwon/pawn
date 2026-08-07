/**
 * Lightweight shell isolation for agent-spawned commands.
 *
 * Desktop agents cannot get full container isolation without root privileges,
 * but we can still:
 *  - strip most inherited environment variables (allowlist)
 *  - block obvious destructive / privilege-escalation patterns
 *  - optionally wrap with macOS sandbox-exec (network-off profile)
 *  - keep cwd confined when a project root is known
 */
import { resolve, normalize, sep } from 'path'

export type SandboxOptions = {
  /** When true (default for agent shell_exec), apply env allowlist + denylist. */
  enabled?: boolean
  /** Allow outbound network (default true). When false, try OS sandbox if available. */
  network?: boolean
  /** Project root used to validate cwd (jail). */
  projectRoot?: string
  /** When true (default if projectRoot set), refuse cwd outside project root. */
  jailCwd?: boolean
}

/** Ensure cwd resolves under projectRoot (best-effort; not a full security boundary). */
export function jailCwd(
  cwd: string | undefined,
  projectRoot: string | undefined
): { ok: true; cwd?: string } | { ok: false; error: string } {
  if (!projectRoot) return { ok: true, cwd }
  // Reject null-byte injection and empty roots.
  if (projectRoot.includes('\0') || (cwd && cwd.includes('\0'))) {
    return { ok: false, error: 'Sandbox cwd jail: invalid path (null byte)' }
  }
  const root = resolve(projectRoot)
  const target = resolve(cwd || projectRoot)
  // Normalize + force trailing sep on root so `/proj` does not match `/proj-evil`.
  const rootNorm = normalize(root)
  const targetNorm = normalize(target)
  const rootPrefix = rootNorm.endsWith(sep) ? rootNorm : rootNorm + sep
  if (targetNorm === rootNorm || targetNorm.startsWith(rootPrefix)) {
    return { ok: true, cwd: targetNorm }
  }
  return {
    ok: false,
    error: `Sandbox cwd jail: refused path outside project root\ncwd=${targetNorm}\nroot=${rootNorm}`
  }
}

const ENV_ALLOW = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'NODE_ENV',
  'npm_config_user_agent',
  'npm_config_registry',
  'SSH_AUTH_SOCK',
  'XPC_FLAGS',
  'XPC_SERVICE_NAME',
  // Locale / display for CLI tools
  'DISPLAY',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  // Common SDK roots (read-only tooling)
  'GOPATH',
  'GOROOT',
  'JAVA_HOME',
  'RUSTUP_HOME',
  'CARGO_HOME',
  'NVM_DIR',
  'FNM_MULTISHELL_PATH',
  'PYENV_ROOT',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'ANDROID_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME'
])

/** Prefixes always passed through (e.g. PATH-like custom toolchains). */
const ENV_PREFIX_ALLOW = ['PATH_', 'LC_', 'npm_config_', 'BUN_', 'PNPM_', 'YARN_']

/**
 * Patterns that should never run unattended from the agent, even with user yolo.
 * These are best-effort string guards — not a security boundary by themselves.
 */
const DANGEROUS_RE = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)*\/\s*$/i,
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\s+(\/|~|\$HOME)\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bcurl\b[^|\n]*\|\s*(ba)?sh\b/i,
  /\bwget\b[^|\n]*\|\s*(ba)?sh\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\bchown\s+-R\s+root\b/i,
  /\bsudo\b/i,
  /\bdoas\b/i,
  /\blaunchctl\b/i,
  /\bdiskutil\s+erase/i,
  /\bsecurity\s+delete-keychain\b/i,
  /\b:(){ :\|:& };:/, // fork bomb
  /\bnc\s+-[elp]/i, // reverse shells common flags
  /\bpython[23]?\s+-c\s+['"][^'"]*socket\b/i
]

export function sanitizeEnv(
  base: NodeJS.ProcessEnv = process.env,
  extra?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v == null) continue
    if (ENV_ALLOW.has(k) || ENV_PREFIX_ALLOW.some((p) => k.startsWith(p))) {
      out[k] = v
    }
  }
  // Never pass secrets-looking keys even if allowlisted by mistake
  for (const k of Object.keys(out)) {
    if (/(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/i.test(k) && k !== 'SSH_AUTH_SOCK') {
      delete out[k]
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  // Ensure a minimal PATH
  if (!out.PATH) {
    out.PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  }
  return out
}

export function checkDangerousCommand(command: string): string | null {
  const c = command.trim()
  if (!c) return 'Empty command'
  for (const re of DANGEROUS_RE) {
    if (re.test(c)) {
      return `Blocked by sandbox policy (dangerous pattern): ${re.source.slice(0, 60)}`
    }
  }
  return null
}

/** macOS Seatbelt profile: allow most local ops, deny network sockets. */
export function macNetworkOffProfile(): string {
  return `(version 1)
(deny default)
(allow process*)
(allow file-read*)
(allow file-write*)
(allow sysctl-read)
(allow mach-lookup)
(allow system-socket)
(deny network*)
`
}

export type SpawnPlan = {
  file: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  sandboxNote?: string
}

/**
 * Build spawn parameters for a shell command under the requested sandbox policy.
 */
export function planShellSpawn(
  command: string,
  cwd: string | undefined,
  opts: SandboxOptions = {}
): { ok: true; plan: SpawnPlan } | { ok: false; error: string } {
  const enabled = opts.enabled !== false
  const network = opts.network !== false
  const wantJail = opts.jailCwd !== false && Boolean(opts.projectRoot)

  if (enabled) {
    const danger = checkDangerousCommand(command)
    if (danger) return { ok: false, error: danger }
  }

  let safeCwd = cwd
  if (enabled && wantJail) {
    const j = jailCwd(cwd, opts.projectRoot)
    if (!j.ok) return { ok: false, error: j.error }
    safeCwd = j.cwd
  }

  const env = enabled ? sanitizeEnv(process.env) : ({ ...process.env } as Record<string, string>)
  const isWin = process.platform === 'win32'
  const shell = isWin ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/bash'
  const shellArgs = isWin ? ['/d', '/s', '/c', command] : ['-lc', command]
  const jailNote = wantJail && enabled ? ' cwd-jail' : ''

  // Network-off: wrap with sandbox-exec on macOS when available later (spawn side).
  if (enabled && !network && process.platform === 'darwin') {
    return {
      ok: true,
      plan: {
        file: '/usr/bin/sandbox-exec',
        args: ['-p', macNetworkOffProfile(), shell, ...shellArgs],
        env,
        cwd: safeCwd,
        sandboxNote: `sandbox=on network=off (sandbox-exec)${jailNote}`
      }
    }
  }

  return {
    ok: true,
    plan: {
      file: shell,
      args: shellArgs,
      env,
      cwd: safeCwd,
      sandboxNote: enabled
        ? `sandbox=on network=${network ? 'on' : 'off'} env=allowlist${jailNote}`
        : 'sandbox=off'
    }
  }
}

export function planExecFile(
  file: string,
  args: string[],
  cwd: string | undefined,
  opts: SandboxOptions = {}
): { ok: true; plan: SpawnPlan } | { ok: false; error: string } {
  const enabled = opts.enabled !== false
  const wantJail = opts.jailCwd !== false && Boolean(opts.projectRoot)
  // Reconstruct a pseudo-command for denylist heuristics
  const pseudo = [file, ...args].join(' ')
  if (enabled) {
    const danger = checkDangerousCommand(pseudo)
    if (danger) return { ok: false, error: danger }
  }
  let safeCwd = cwd
  if (enabled && wantJail) {
    const j = jailCwd(cwd, opts.projectRoot)
    if (!j.ok) return { ok: false, error: j.error }
    safeCwd = j.cwd
  }
  const env = enabled ? sanitizeEnv(process.env) : ({ ...process.env } as Record<string, string>)
  return {
    ok: true,
    plan: {
      file,
      args,
      env,
      cwd: safeCwd,
      sandboxNote: enabled
        ? `sandbox=on env=allowlist (execFile)${wantJail ? ' cwd-jail' : ''}`
        : 'sandbox=off'
    }
  }
}
