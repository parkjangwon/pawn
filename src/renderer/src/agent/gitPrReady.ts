/**
 * Local git "ready for PR" pack: branch, remote, status, log, diff stat, checklist.
 */

export async function gitPrReady(projectPath: string, baseBranch?: string): Promise<string> {
  const cwd = projectPath
  const exec = (args: string[]) => window.api.shell.execFile('git', args, cwd, 30_000)

  const [branch, status, remote, upstream, log, diffStat, revList] = await Promise.all([
    exec(['rev-parse', '--abbrev-ref', 'HEAD']),
    exec(['status', '--short', '--branch']),
    exec(['remote', '-v']),
    exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    exec(['log', '-n12', '--oneline', '--decorate']),
    exec(['diff', 'HEAD', '--stat']),
    baseBranch
      ? exec(['rev-list', '--left-right', '--count', `${baseBranch}...HEAD`])
      : exec(['rev-list', '--left-right', '--count', 'origin/HEAD...HEAD']).catch(() => ({
          exitCode: 1,
          stdout: '',
          stderr: ''
        }))
  ])

  // origin default base guess
  let base = baseBranch || ''
  if (!base) {
    const sym = await exec(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    if (sym.exitCode === 0 && sym.stdout.includes('origin/')) {
      base = sym.stdout.trim().replace('refs/remotes/origin/', '')
    } else {
      base = 'main'
    }
  }

  const vsBase = await exec(['log', '--oneline', `${base}..HEAD`])
  const diffBase = await exec(['diff', '--stat', `${base}...HEAD`])

  // remote github repo from origin url
  let githubRepo = ''
  const originLine = (remote.stdout || '').split('\n').find((l) => l.startsWith('origin') && l.includes('github.com'))
  if (originLine) {
    const m =
      /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?(?:\s|$)/.exec(originLine) ||
      /github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?/.exec(originLine)
    if (m) githubRepo = m[1].replace(/\.git$/, '')
  }

  const dirty = (status.stdout || '').split('\n').some((l) => l && !l.startsWith('##'))
  const lines = [
    '# git_pr_ready',
    `cwd: ${cwd}`,
    `branch: ${branch.stdout.trim() || '(unknown)'}`,
    `upstream: ${upstream.exitCode === 0 ? upstream.stdout.trim() : '(none set)'}`,
    `suggested_base: ${base}`,
    githubRepo ? `github_repo: ${githubRepo}` : 'github_repo: (could not parse origin)',
    '',
    '## Status',
    status.stdout.trim() || '(empty)',
    dirty ? '\n⚠️ Working tree has uncommitted changes — commit or stash before opening a PR.' : '✓ Clean enough for PR (no unstaged short-status lines).',
    '',
    '## Recent commits (HEAD)',
    log.stdout.trim() || '(none)',
    '',
    `## Commits not in ${base}`,
    vsBase.stdout.trim() || `(none — already up to date with ${base}?)`,
    '',
    `## Diff stat vs ${base}`,
    diffBase.stdout.trim() || diffStat.stdout.trim() || '(no diff)',
    revList.stdout.trim() ? `\n## Ahead/behind count\n${revList.stdout.trim()}` : '',
    '',
    '## Checklist',
    '- [ ] run_checks (typecheck/test) passes',
    '- [ ] Commit messages are clear',
    '- [ ] No secrets in diff',
    githubRepo
      ? `- [ ] Open PR: github_create_pull with repo=${githubRepo} head=${branch.stdout.trim()} base=${base}`
      : '- [ ] Set origin remote, then github_create_pull',
    '- [ ] After open: github_review_pull for a full review pack'
  ]
  return lines.filter((l) => l !== undefined).join('\n')
}
