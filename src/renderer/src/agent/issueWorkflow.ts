/**
 * Issue → PR playbook helper (SWE-agent / Claude Code inspired).
 * Thin: gathers context; the agent loop executes steps with existing tools.
 */

export function buildIssuePrPlaybook(opts: {
  issueRef: string
  repoHint?: string
}): string {
  const ref = opts.issueRef.trim()
  const repo = opts.repoHint?.trim()
  return [
    `<issue_to_pr_playbook>`,
    `You are executing Pawn's Issue→PR workflow. Stay on task; keep diffs minimal.`,
    ``,
    `## Target`,
    `issue: ${ref}`,
    repo ? `repo_hint: ${repo}` : `repo_hint: (infer from git remote or ask)`,
    ``,
    `## Steps (use tools; do not skip verification)`,
    `1. Resolve issue details:`,
    `   - If GitHub: github_get_issue or github_review_pull context; else gitlab_get_issue; else web_fetch public URL.`,
    `2. Local prep: git_status, git_log(limit=5); git_branch(create:true) if a feature branch is needed.`,
    `3. Locate code: repo_map or codebase_search + grep_search; read_file before edit.`,
    `4. Implement the smallest fix; prefer edit_file; update_plan for multi-step; spawn_agent for parallel investigation when multi-module.`,
    `5. Verify: run_checks(kind="typecheck") then kind="test" if available.`,
    `6. Review: git_diff, git_pr_ready. Stage with git_add, commit with git_commit (real message).`,
    `7. Open PR only if user asked or clearly implied: git_push then github_create_pull / gitlab_create_merge_request.`,
    `   Otherwise stop after a ready summary (title, body, files, how to verify).`,
    ``,
    `## Done criteria`,
    `- Issue requirements addressed or gaps listed explicitly`,
    `- Checks green or failures explained`,
    `- No secrets in diff`,
    `</issue_to_pr_playbook>`
  ].join('\n')
}

/** Parse "/issue-pr 42" or full URL from slash text. */
export function parseIssuePrArg(raw: string): { issueRef: string; repoHint?: string } | null {
  const s = raw.trim()
  if (!s) return null
  // URL
  if (/^https?:\/\//i.test(s)) return { issueRef: s }
  // owner/repo#123
  const full = s.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/)
  if (full) return { issueRef: `#${full[2]}`, repoHint: full[1] }
  // #123 or 123
  const num = s.match(/^#?(\d+)$/)
  if (num) return { issueRef: `#${num[1]}` }
  return { issueRef: s }
}
