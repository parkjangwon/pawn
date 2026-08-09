/**
 * Structured git write helpers used by agent tools.
 * Prefer these over raw shell_exec so we can enforce message quality,
 * staged-diff review, and push safety.
 */

import { formatSecretScanBlock, scanForSecrets } from './secretScan'

export type ShellExecFile = (
  file: string,
  args: string[],
  cwd?: string,
  timeoutMs?: number
) => Promise<{ stdout: string; stderr: string; exitCode: number; killed?: boolean }>

export type GitWriteResult = { ok: boolean; text: string }

const MSG_MIN = 3
const MSG_MAX = 2000
const TRAILER_RE = /^(Co-authored-by|Signed-off-by|Made-with):/im

/** Conventional / sensible commit message rules (soft). */
export function validateCommitMessage(message: string): string | null {
  const msg = message.replace(/\r\n/g, '\n').trim()
  if (msg.length < MSG_MIN) return `Commit message too short (min ${MSG_MIN} chars)`
  if (msg.length > MSG_MAX) return `Commit message too long (max ${MSG_MAX} chars)`
  if (/^(wip|fix|tmp|asdf|test)\s*$/i.test(msg)) {
    return 'Commit message looks like a placeholder (wip/fix/tmp) — write a real summary'
  }
  if (msg.includes('\0')) return 'Commit message contains NUL'
  // Disallow only-trailer bodies
  const body = msg
    .split('\n')
    .filter((l) => !TRAILER_RE.test(l.trim()))
    .join('\n')
    .trim()
  if (!body) return 'Commit message body empty after trailers'
  const secrets = scanForSecrets(msg)
  if (secrets.length) return formatSecretScanBlock(secrets)
  return null
}

/** Soft preflight: scan commit message + optional staged patch for secrets. */
export async function secretPreflight(
  execFile: ShellExecFile,
  cwd: string,
  message: string
): Promise<string | null> {
  const msgHits = scanForSecrets(message)
  if (msgHits.length) return formatSecretScanBlock(msgHits)
  try {
    const diff = await execFile('git', ['diff', '--cached', '--no-color'], cwd, 20_000)
    const sample = (diff.stdout || '').slice(0, 80_000)
    const hits = scanForSecrets(sample)
    if (hits.length) return formatSecretScanBlock(hits)
  } catch {
    /* ignore */
  }
  return null
}

export async function gitAdd(
  execFile: ShellExecFile,
  cwd: string,
  paths: string[] | 'all'
): Promise<GitWriteResult> {
  const args =
    paths === 'all' || paths.length === 0
      ? ['add', '-A']
      : ['add', '--', ...paths.map((p) => p.trim()).filter(Boolean)]
  if (paths !== 'all' && args.length === 2) {
    return { ok: false, text: 'No paths to add' }
  }
  const r = await execFile('git', args, cwd, 60_000)
  if (r.exitCode !== 0) {
    return { ok: false, text: r.stderr || r.stdout || 'git add failed' }
  }
  const st = await execFile('git', ['status', '--short'], cwd, 15_000)
  return {
    ok: true,
    text: `Staged${paths === 'all' ? ' all changes' : ''}.\n${st.stdout.trim() || '(clean)'}`
  }
}

export async function gitCommit(
  execFile: ShellExecFile,
  cwd: string,
  opts: { message: string; allowEmpty?: boolean; noVerify?: boolean }
): Promise<GitWriteResult> {
  const msgErr = validateCommitMessage(opts.message)
  if (msgErr) return { ok: false, text: msgErr }
  const secretErr = await secretPreflight(execFile, cwd, opts.message)
  if (secretErr) return { ok: false, text: secretErr }

  // Require staged changes unless allowEmpty
  const staged = await execFile('git', ['diff', '--cached', '--stat'], cwd, 15_000)
  const hasStaged = Boolean(staged.stdout.trim())
  if (!hasStaged && !opts.allowEmpty) {
    return {
      ok: false,
      text:
        'Nothing staged. Run git_add first, or pass paths. Use git_status to review.\n' +
        (await execFile('git', ['status', '--short'], cwd, 15_000)).stdout
    }
  }

  const args = ['commit', '-m', opts.message.trim()]
  if (opts.noVerify) args.push('--no-verify')
  if (opts.allowEmpty) args.push('--allow-empty')

  const r = await execFile('git', args, cwd, 60_000)
  if (r.exitCode !== 0) {
    return { ok: false, text: r.stderr || r.stdout || 'git commit failed' }
  }

  const log = await execFile('git', ['log', '-1', '--oneline', '--decorate'], cwd, 10_000)
  const stat = staged.stdout.trim()
  return {
    ok: true,
    text: [
      'Commit created.',
      log.stdout.trim(),
      '',
      'Staged diffstat at commit time:',
      stat || '(empty)',
      r.stdout.trim()
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export async function gitPush(
  execFile: ShellExecFile,
  cwd: string,
  opts: { remote?: string; branch?: string; setUpstream?: boolean; force?: boolean }
): Promise<GitWriteResult> {
  if (opts.force) {
    return {
      ok: false,
      text: 'Force push is disabled in git_push tool. Use an explicit shell command only if the user clearly requested it.'
    }
  }

  // Guard: refuse if there are no commits ahead and nothing to push? Still allow.
  const branchRes = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 10_000)
  if (branchRes.exitCode !== 0) {
    return { ok: false, text: branchRes.stderr || 'Not a git repository' }
  }
  const branch = opts.branch || branchRes.stdout.trim()
  const remote = opts.remote || 'origin'

  // Block push of detached HEAD without explicit branch
  if (branch === 'HEAD' && !opts.branch) {
    return { ok: false, text: 'Detached HEAD — pass branch name explicitly to push' }
  }

  const status = await execFile('git', ['status', '--short'], cwd, 15_000)
  const dirty = status.stdout.trim()

  const args = ['push']
  if (opts.setUpstream !== false) {
    // set-upstream when no upstream configured
    const up = await execFile(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      cwd,
      10_000
    )
    if (up.exitCode !== 0) {
      args.push('-u', remote, branch)
    } else {
      args.push(remote, branch)
    }
  } else {
    args.push(remote, branch)
  }

  const r = await execFile('git', args, cwd, 120_000)
  if (r.exitCode !== 0) {
    return { ok: false, text: r.stderr || r.stdout || 'git push failed' }
  }
  return {
    ok: true,
    text: [
      `Pushed ${branch} → ${remote}`,
      r.stdout.trim() || r.stderr.trim() || 'ok',
      dirty ? `\nNote: working tree still has uncommitted changes:\n${dirty}` : null
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export async function gitBranchOp(
  execFile: ShellExecFile,
  cwd: string,
  opts: { name?: string; create?: boolean; list?: boolean; delete?: boolean }
): Promise<GitWriteResult> {
  if (opts.list || (!opts.name && !opts.create && !opts.delete)) {
    const r = await execFile('git', ['branch', '-vv'], cwd, 15_000)
    return {
      ok: r.exitCode === 0,
      text: r.stdout.trim() || r.stderr || '(no branches)'
    }
  }
  const name = (opts.name || '').trim()
  if (!name || !/^[A-Za-z0-9._/+=@-]+$/.test(name) || name.startsWith('-')) {
    return { ok: false, text: 'Invalid branch name' }
  }
  if (opts.delete) {
    const r = await execFile('git', ['branch', '-d', name], cwd, 15_000)
    return {
      ok: r.exitCode === 0,
      text: r.stdout.trim() || r.stderr || `Deleted ${name}`
    }
  }
  // create and/or checkout
  if (opts.create) {
    const r = await execFile('git', ['checkout', '-b', name], cwd, 15_000)
    return {
      ok: r.exitCode === 0,
      text: r.stdout.trim() || r.stderr || `Created and checked out ${name}`
    }
  }
  const r = await execFile('git', ['checkout', name], cwd, 15_000)
  return {
    ok: r.exitCode === 0,
    text: r.stdout.trim() || r.stderr || `Checked out ${name}`
  }
}

export async function gitStash(
  execFile: ShellExecFile,
  cwd: string,
  opts: { action?: 'push' | 'pop' | 'list' | 'drop'; message?: string }
): Promise<GitWriteResult> {
  const action = opts.action || 'push'
  if (action === 'list') {
    const r = await execFile('git', ['stash', 'list'], cwd, 15_000)
    return { ok: true, text: r.stdout.trim() || '(empty stash)' }
  }
  if (action === 'pop') {
    const r = await execFile('git', ['stash', 'pop'], cwd, 30_000)
    return {
      ok: r.exitCode === 0,
      text: r.stdout.trim() || r.stderr || 'stash pop'
    }
  }
  if (action === 'drop') {
    const r = await execFile('git', ['stash', 'drop'], cwd, 15_000)
    return {
      ok: r.exitCode === 0,
      text: r.stdout.trim() || r.stderr || 'stash drop'
    }
  }
  const args = ['stash', 'push', '--include-untracked']
  if (opts.message?.trim()) args.push('-m', opts.message.trim())
  const r = await execFile('git', args, cwd, 30_000)
  return {
    ok: r.exitCode === 0,
    text: r.stdout.trim() || r.stderr || 'stashed'
  }
}
