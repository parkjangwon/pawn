/**
 * Bounded tool scope for subagents — beyond allow/deny tool name lists:
 * path globs, mutating-tool budgets, and shell caps.
 */
import type { ToolCall } from './toolDefinitionsTypes'
import type { AgentProfile } from './agentProfiles'

/** Tools that mutate the tree or run unconstrained shell. */
export const MUTATING_FILE_TOOLS = new Set([
  'edit_file',
  'write_file',
  'create_file',
  'delete_file',
  'move_file',
  'rename_file',
  'apply_patch',
  'str_replace'
])

export const SHELL_TOOLS = new Set(['shell_exec', 'run_terminal', 'bash'])

const PATH_ARG_KEYS = [
  'path',
  'file_path',
  'filepath',
  'file',
  'target',
  'target_path',
  'destination',
  'dest',
  'src',
  'source',
  'from',
  'to',
  'cwd',
  'rootPath',
  'root_path',
  'dir',
  'directory'
]

export type ToolBudgetState = {
  edits: number
  shell: number
  total: number
}

export function emptyToolBudget(): ToolBudgetState {
  return { edits: 0, shell: 0, total: 0 }
}

/**
 * Minimal gitignore-style glob: `*` (segment), `**` (any depth), `?` one char.
 * Patterns are matched against posix-normalized relative paths.
 */
export function matchPathGlob(pattern: string, filePath: string): boolean {
  const pat = pattern.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const path = filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!pat) return false
  if (pat === '**' || pat === '**/*') return true

  // Escape regex specials except our glob tokens.
  let re = ''
  let i = 0
  while (i < pat.length) {
    if (pat[i] === '*' && pat[i + 1] === '*') {
      // ** or **/
      if (pat[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 3
      } else {
        re += '.*'
        i += 2
      }
      continue
    }
    if (pat[i] === '*') {
      re += '[^/]*'
      i++
      continue
    }
    if (pat[i] === '?') {
      re += '[^/]'
      i++
      continue
    }
    const c = pat[i]
    if (/[.+^${}()|[\]\\]/.test(c)) re += '\\' + c
    else re += c
    i++
  }
  try {
    return new RegExp(`^${re}$`, 'i').test(path)
  } catch {
    return path === pat
  }
}

export function matchesAnyGlob(patterns: string[] | undefined, filePath: string): boolean {
  if (!patterns?.length) return false
  return patterns.some((p) => matchPathGlob(p, filePath))
}

/** Pull likely path-like string args from a tool call. */
export function extractToolPaths(call: Pick<ToolCall, 'name' | 'arguments'>): string[] {
  const args = (call.arguments || {}) as Record<string, unknown>
  const out: string[] = []
  for (const key of PATH_ARG_KEYS) {
    const v = args[key]
    if (typeof v === 'string' && v.trim()) out.push(v.trim())
  }
  // Nested common shapes
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) {
      if (typeof p === 'string' && p.trim()) out.push(p.trim())
    }
  }
  if (Array.isArray(args.files)) {
    for (const p of args.files) {
      if (typeof p === 'string' && p.trim()) out.push(p.trim())
    }
  }
  return out
}

/** Normalize to project-relative when possible. */
export function toProjectRelative(filePath: string, projectPath?: string): string {
  let p = filePath.replace(/\\/g, '/')
  if (projectPath) {
    const root = projectPath.replace(/\\/g, '/').replace(/\/$/, '')
    if (p.startsWith(root + '/')) p = p.slice(root.length + 1)
    else if (p === root) p = '.'
  }
  // Strip worktree prefix noise: .pawn/worktrees/<id>/...
  const wt = p.match(/^\.pawn\/worktrees\/[^/]+\/(.*)$/)
  if (wt) p = wt[1]
  return p.replace(/^\.\//, '')
}

export type ToolPolicyDecision = {
  allowed: boolean
  reason?: string
  /** Increment budgets only when allowed and tool is mutating/shell. */
  countAsEdit?: boolean
  countAsShell?: boolean
}

export type ToolPolicyProfile = Pick<
  AgentProfile,
  'tools' | 'disallowedTools' | 'pathAllow' | 'pathDeny' | 'maxEdits' | 'maxShell' | 'maxToolCalls'
>

export function profileAllowsToolName(
  name: string,
  profile: Pick<AgentProfile, 'tools' | 'disallowedTools'>
): boolean {
  if (profile.disallowedTools?.includes(name)) return false
  if (profile.tools && profile.tools.length > 0) {
    if (name.startsWith('mcp__')) {
      return profile.tools.some((t) => t === name || t === 'mcp' || t.startsWith('mcp__'))
    }
    return profile.tools.includes(name)
  }
  return true
}

/**
 * Full policy check for one tool call (name + paths + budgets).
 * Call after name allow; updates caller-owned budget when allowed.
 */
export function checkSubagentToolCall(
  call: Pick<ToolCall, 'name' | 'arguments'>,
  profile: ToolPolicyProfile,
  budget: ToolBudgetState,
  opts?: { projectPath?: string }
): ToolPolicyDecision {
  const name = call.name
  if (!profileAllowsToolName(name, profile)) {
    return { allowed: false, reason: `Tool "${name}" is not allowed for this subagent profile` }
  }

  const maxTotal = profile.maxToolCalls
  if (maxTotal != null && budget.total >= maxTotal) {
    return {
      allowed: false,
      reason: `Tool call budget exhausted (maxToolCalls=${maxTotal})`
    }
  }

  const isEdit = MUTATING_FILE_TOOLS.has(name)
  const isShell = SHELL_TOOLS.has(name)

  if (isEdit && profile.maxEdits != null && budget.edits >= profile.maxEdits) {
    return {
      allowed: false,
      reason: `Edit budget exhausted (maxEdits=${profile.maxEdits})`
    }
  }
  if (isShell && profile.maxShell != null && budget.shell >= profile.maxShell) {
    return {
      allowed: false,
      reason: `Shell budget exhausted (maxShell=${profile.maxShell})`
    }
  }

  const rawPaths = extractToolPaths(call)
  if (rawPaths.length > 0 && (profile.pathAllow?.length || profile.pathDeny?.length)) {
    for (const raw of rawPaths) {
      const rel = toProjectRelative(raw, opts?.projectPath)
      // Absolute escapes outside project still get checked as full string.
      if (profile.pathDeny?.length && matchesAnyGlob(profile.pathDeny, rel)) {
        return {
          allowed: false,
          reason: `Path blocked by pathDeny: ${rel}`
        }
      }
      // pathAllow only applies to file-mutating tools + write-ish; reads can
      // still scan (explore) unless pathAllow is set AND tool is mutating.
      // If pathAllow is set, ALL path-bearing tools must match (tight sandbox).
      if (profile.pathAllow?.length && !matchesAnyGlob(profile.pathAllow, rel)) {
        // Allow non-mutating tools to miss allowlist only when path is clearly
        // outside "edit" class — still enforce allow for edits/shell cwd.
        if (isEdit || isShell || name === 'write_file' || name === 'delete_file') {
          return {
            allowed: false,
            reason: `Path outside pathAllow: ${rel} (allowed: ${profile.pathAllow.join(', ')})`
          }
        }
      }
    }
  }

  // Absolute path escape: if projectPath known and mutating path is outside root.
  if (opts?.projectPath && isEdit) {
    const root = opts.projectPath.replace(/\\/g, '/').replace(/\/$/, '')
    for (const raw of rawPaths) {
      const n = raw.replace(/\\/g, '/')
      if (n.startsWith('/') || /^[A-Za-z]:\//.test(n)) {
        if (n !== root && !n.startsWith(root + '/')) {
          // Worktree paths under project are ok after relativize; absolute outside root = deny
          const rel = toProjectRelative(n, opts.projectPath)
          if (rel === n || rel.startsWith('..')) {
            return { allowed: false, reason: `Refused path outside project: ${raw}` }
          }
        }
      }
    }
  }

  return {
    allowed: true,
    countAsEdit: isEdit,
    countAsShell: isShell
  }
}

export function applyBudget(
  budget: ToolBudgetState,
  decision: ToolPolicyDecision
): void {
  if (!decision.allowed) return
  budget.total++
  if (decision.countAsEdit) budget.edits++
  if (decision.countAsShell) budget.shell++
}

/** After this many consecutive fully-blocked tool rounds, abort the run. */
export const MAX_CONSECUTIVE_POLICY_BLOCKS = 3

export function isBudgetExhaustedReason(reason: string): boolean {
  return /budget exhausted/i.test(reason)
}

export function isPolicyHardBlockReason(reason: string): boolean {
  return (
    isBudgetExhaustedReason(reason) ||
    /path blocked by pathdeny/i.test(reason) ||
    /path outside pathallow/i.test(reason) ||
    /refused path outside project/i.test(reason) ||
    /is not allowed for this subagent/i.test(reason)
  )
}

/**
 * Update consecutive full-block counter after a tool round.
 * Resets when any tool was allowed through policy.
 */
export function nextPolicyBlockStreak(
  prev: number,
  opts: { totalCalls: number; blockedCount: number; anyAllowed: boolean }
): number {
  if (opts.totalCalls <= 0) return prev
  if (opts.anyAllowed) return 0
  if (opts.blockedCount >= opts.totalCalls) return prev + 1
  return prev
}

export function shouldEarlyStopPolicy(opts: {
  streak: number
  blockedReasons: string[]
}): { stop: boolean; reason?: string } {
  if (opts.blockedReasons.some(isBudgetExhaustedReason)) {
    return {
      stop: true,
      reason: opts.blockedReasons.find(isBudgetExhaustedReason) || 'Tool budget exhausted'
    }
  }
  if (opts.streak >= MAX_CONSECUTIVE_POLICY_BLOCKS) {
    return {
      stop: true,
      reason: `policy_block_storm: ${MAX_CONSECUTIVE_POLICY_BLOCKS} consecutive rounds fully blocked by subagent policy`
    }
  }
  return { stop: false }
}
