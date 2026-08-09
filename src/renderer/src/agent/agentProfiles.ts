/**
 * Subagent profiles — Claude-Code-inspired specialized workers.
 *
 * Built-ins: explore, plan, worker (general-purpose), code-reviewer.
 * Custom: Markdown with YAML frontmatter from (priority high → low):
 *   - {project}/.pawn/agents/*.md
 *   - {project}/.claude/agents/*.md
 *   - ~/.pawn/agents/*.md
 *   - ~/.claude/agents/*.md
 *
 * Frontmatter (optional fields after name/description):
 *   name, description, tools, disallowedTools, model, maxTurns,
 *   isolation (none|worktree), apply (auto|none), thoroughness (quick|medium|very_thorough),
 *   skills (comma list of skill names to preload into the subagent task context),
 *   pathAllow / pathDeny (glob list), maxEdits, maxShell, maxToolCalls
 */

export type AgentThoroughness = 'quick' | 'medium' | 'very_thorough'
export type AgentIsolation = 'none' | 'worktree'
export type AgentApplyMode = 'auto' | 'none'
/** inherit = parent routing; simple|mid|complex = tier hint for auto route. */
export type AgentModelPref = 'inherit' | 'simple' | 'mid' | 'complex' | string

/** Sensible default deny for implementers — never touch secrets via subagent. */
export const DEFAULT_WORKER_PATH_DENY = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '**/secrets/**',
  '**/*secret*',
  '**/*.pem',
  '**/*credentials*'
]

export interface AgentProfile {
  name: string
  description: string
  /** Full system prompt body (markdown after frontmatter). */
  systemPrompt: string
  /** When set, only these tools are exposed. */
  tools?: string[]
  /** Removed from the active set after tools/inherit resolution. */
  disallowedTools?: string[]
  model: AgentModelPref
  maxTurns: number
  isolation: AgentIsolation
  /** What to do with worktree edits after a successful run. */
  apply: AgentApplyMode
  thoroughness?: AgentThoroughness
  /**
   * Skill names to preload (SKILL.md bodies) into the per-run user preamble.
   * Kept out of system layers so prompt-cache stays stable across tasks.
   */
  skills?: string[]
  /** If set, mutating path-bearing tools may only touch matching project-relative globs. */
  pathAllow?: string[]
  /** Always blocked paths (checked before allow). */
  pathDeny?: string[]
  /** Cap edit_file / write_file-class tools per run. */
  maxEdits?: number
  /** Cap shell_exec-class tools per run. */
  maxShell?: number
  /** Cap total tool invocations per run. */
  maxToolCalls?: number
  /** Built-in vs loaded from disk. */
  source: 'builtin' | 'project' | 'user'
  sourcePath?: string
}

const EXPLORE_TOOLS = [
  'read_file',
  'read_spreadsheet',
  'list_dir',
  'search_files',
  'grep_search',
  'codebase_search',
  'repo_map',
  'git_status',
  'git_diff',
  'git_log',
  'git_pr_ready',
  'web_search',
  'web_fetch',
  'web_research',
  'memory_search',
  'memory_list',
  'load_skill',
  'run_checks',
  'list_artifacts',
  'update_plan',
  'terminal_list',
  'terminal_read',
  'google_whoami',
  'google_drive_search',
  'google_drive_read',
  'google_gmail_search',
  'google_gmail_read',
  'google_calendar_list',
  'google_tasks_list',
  'google_sheets_read',
  'google_docs_read',
  'google_slides_read',
  'github_whoami',
  'github_list_repos',
  'github_get_repo',
  'github_list_issues',
  'github_get_issue',
  'github_list_pulls',
  'github_get_pull',
  'github_review_pull',
  'github_list_commits',
  'github_get_file',
  'github_search_code',
  'github_search_issues',
  'gitlab_whoami',
  'gitlab_list_projects',
  'gitlab_get_project',
  'gitlab_list_issues',
  'gitlab_get_issue',
  'gitlab_list_merge_requests',
  'gitlab_get_merge_request',
  'gitlab_list_commits',
  'gitlab_get_file',
  'gitlab_search',
  'codecommit_whoami',
  'codecommit_list_repos',
  'codecommit_get_repo',
  'codecommit_list_branches',
  'codecommit_get_branch',
  'codecommit_list_commits',
  'codecommit_get_file'
]

const WORKER_DENY = [
  'spawn_agent',
  'parallel_agents',
  'list_agents',
  'await_agent',
  'cancel_agent',
  'app_set_permission_mode',
  'app_create_automation',
  'computer_click',
  'computer_move',
  'computer_drag',
  'computer_scroll',
  'computer_type',
  'computer_keypress',
  'computer_clipboard'
]

const REVIEW_TOOLS = [
  'read_file',
  'list_dir',
  'search_files',
  'grep_search',
  'codebase_search',
  'repo_map',
  'git_status',
  'git_diff',
  'git_log',
  'git_pr_ready',
  'run_checks',
  'load_skill'
]

export const BUILTIN_AGENT_PROFILES: AgentProfile[] = [
  {
    name: 'explore',
    description:
      'Fast read-only codebase search and analysis. Use to map code, find symbols, or answer questions without editing. Prefer for investigation that would bloat the main context.',
    systemPrompt:
      'You are Explore, a read-only research subagent.\n' +
      'Search and analyze the codebase thoroughly for the assigned question.\n' +
      '- Use repo_map / codebase_search / grep_search / read_file as needed.\n' +
      '- Do not edit files, run mutating shell, commit, or spawn agents.\n' +
      '- Return a structured summary: findings, key file paths, open questions.\n' +
      '- Prefer precise citations (path + brief quote) over dumping whole files.',
    tools: EXPLORE_TOOLS,
    model: 'simple',
    maxTurns: 12,
    isolation: 'none',
    apply: 'none',
    thoroughness: 'medium',
    maxToolCalls: 80,
    source: 'builtin'
  },
  {
    name: 'plan',
    description:
      'Read-only research agent used before writing a plan. Gathers context for design without mutating the tree.',
    systemPrompt:
      'You are Plan, a read-only planning researcher.\n' +
      'Collect the facts needed for an implementation plan.\n' +
      '- Map relevant modules, constraints, and risks.\n' +
      '- Do not edit, shell-write, or spawn agents.\n' +
      '- End with: goals, proposed steps, files likely touched, risks, unknowns.',
    tools: EXPLORE_TOOLS,
    model: 'mid',
    maxTurns: 10,
    isolation: 'none',
    apply: 'none',
    thoroughness: 'medium',
    maxToolCalls: 70,
    source: 'builtin'
  },
  {
    name: 'worker',
    description:
      'General-purpose implementer: explore + edit + verify. Use for multi-step coding tasks that should not flood the main chat. Defaults to an isolated worktree and auto-applies successful changes.',
    systemPrompt:
      'You are Worker, a focused implementation subagent.\n' +
      'Complete ONLY the assigned task with minimal, correct diffs.\n' +
      '- Prefer edit_file over write_file; run_checks after edits when practical.\n' +
      '- Do not spawn nested agents or change app-wide settings.\n' +
      '- When finished, summarize: what changed, files touched, how to verify, residual risks.',
    disallowedTools: WORKER_DENY,
    model: 'inherit',
    maxTurns: 18,
    isolation: 'worktree',
    apply: 'auto',
    pathDeny: DEFAULT_WORKER_PATH_DENY,
    maxEdits: 48,
    maxShell: 12,
    maxToolCalls: 100,
    source: 'builtin'
  },
  {
    name: 'code-reviewer',
    description:
      'Reviews code for quality, security, and maintainability. Use proactively after non-trivial edits. Read-only.',
    systemPrompt:
      'You are a senior code reviewer.\n' +
      'For each issue: severity (blocker/major/minor), location, why it matters, concrete fix.\n' +
      '- Focus on correctness, security, edge cases, and API clarity.\n' +
      '- Do not rewrite the whole file unless necessary; prefer targeted suggestions.\n' +
      '- End with a short prioritized action list.',
    tools: REVIEW_TOOLS,
    model: 'mid',
    maxTurns: 10,
    isolation: 'none',
    apply: 'none',
    maxToolCalls: 60,
    source: 'builtin'
  }
]

function parsePositiveInt(v: string | undefined, fallback?: number): number | undefined {
  if (v == null || v === '') return fallback
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 1) return fallback
  return n
}

/** Parse simple YAML-ish frontmatter (key: value lines). No nested objects. */
export function parseAgentMarkdown(raw: string, fallbackName: string): {
  meta: Record<string, string>
  body: string
} {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) {
    return { meta: { name: fallbackName }, body: text.trim() }
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) {
    return { meta: { name: fallbackName }, body: text.trim() }
  }
  const fm = text.slice(3, end).replace(/^\r?\n/, '')
  const body = text.slice(end + 4).replace(/^\r?\n/, '').trim()
  const meta: Record<string, string> = {}
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    meta[m[1]] = v
  }
  if (!meta.name) meta.name = fallbackName
  return { meta, body }
}

/** Map common Claude Code tool names → Pawn tools for .claude/agents compatibility. */
const CLAUDE_TOOL_ALIASES: Record<string, string> = {
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'edit_file',
  Grep: 'grep_search',
  Glob: 'search_files',
  Bash: 'shell_exec',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Task: 'spawn_agent',
  Agent: 'spawn_agent'
}

function splitList(v: string | undefined): string[] | undefined {
  if (!v?.trim()) return undefined
  return v
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => CLAUDE_TOOL_ALIASES[s] || s)
}

function parseIsolation(v: string | undefined): AgentIsolation {
  return v === 'worktree' ? 'worktree' : 'none'
}

function parseApply(v: string | undefined, isolation: AgentIsolation): AgentApplyMode {
  if (v === 'auto' || v === 'none') return v
  return isolation === 'worktree' ? 'auto' : 'none'
}

function parseThoroughness(v: string | undefined): AgentThoroughness | undefined {
  if (v === 'quick' || v === 'medium' || v === 'very_thorough' || v === 'very-thorough') {
    return v === 'very-thorough' ? 'very_thorough' : v
  }
  return undefined
}

export function profileFromMarkdown(
  raw: string,
  fallbackName: string,
  source: 'project' | 'user',
  sourcePath: string
): AgentProfile | null {
  const { meta, body } = parseAgentMarkdown(raw, fallbackName)
  const name = (meta.name || fallbackName).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64)
  if (!name) return null
  const isolation = parseIsolation(meta.isolation)
  const maxTurns = Math.min(25, Math.max(1, Math.floor(Number(meta.maxTurns || meta.max_turns || 12) || 12)))
  return {
    name,
    description: meta.description || `Custom agent ${name}`,
    systemPrompt: body || `You are the ${name} subagent. Complete the assigned task carefully.`,
    tools: splitList(meta.tools),
    disallowedTools: splitList(meta.disallowedTools || meta.disallowed_tools),
    model: (meta.model as AgentModelPref) || 'inherit',
    maxTurns,
    isolation,
    apply: parseApply(meta.apply, isolation),
    thoroughness: parseThoroughness(meta.thoroughness),
    skills: splitList(meta.skills),
    pathAllow: splitList(meta.pathAllow || meta.path_allow),
    pathDeny: splitList(meta.pathDeny || meta.path_deny),
    maxEdits: parsePositiveInt(meta.maxEdits || meta.max_edits),
    maxShell: parsePositiveInt(meta.maxShell || meta.max_shell),
    maxToolCalls: parsePositiveInt(meta.maxToolCalls || meta.max_tool_calls),
    source,
    sourcePath
  }
}

async function loadAgentsFromDir(
  root: string,
  source: 'project' | 'user'
): Promise<AgentProfile[]> {
  const api = window.api?.fs
  if (!api?.listDir || !api.readFile) return []
  const entries = await api.listDir(root)
  if (!Array.isArray(entries)) return []
  const out: AgentProfile[] = []
  for (const entry of entries) {
    if (entry.isDirectory) {
      // Recursive one level: agents/review/foo.md
      const nested = await api.listDir(entry.path)
      if (!Array.isArray(nested)) continue
      for (const f of nested) {
        if (f.isDirectory || !f.name.toLowerCase().endsWith('.md')) continue
        const raw = await api.readFile(f.path)
        if (typeof raw !== 'string') continue
        const p = profileFromMarkdown(raw, f.name.replace(/\.md$/i, ''), source, f.path)
        if (p) out.push(p)
      }
      continue
    }
    if (!entry.name.toLowerCase().endsWith('.md')) continue
    const raw = await api.readFile(entry.path)
    if (typeof raw !== 'string') continue
    const p = profileFromMarkdown(raw, entry.name.replace(/\.md$/i, ''), source, entry.path)
    if (p) out.push(p)
  }
  return out
}

/**
 * Resolve all available profiles. Higher-priority sources override same name.
 * Priority: project .pawn > project .claude > user .pawn > user .claude > builtin
 */
export async function loadAgentProfiles(projectPath?: string): Promise<AgentProfile[]> {
  const byName = new Map<string, AgentProfile>()
  for (const b of BUILTIN_AGENT_PROFILES) byName.set(b.name, b)

  const home = (await window.api?.fs?.homeDir?.().catch(() => null)) || null
  const dirs: Array<{ path: string; source: 'project' | 'user' }> = []
  if (home) {
    dirs.push({ path: `${home}/.claude/agents`, source: 'user' })
    dirs.push({ path: `${home}/.pawn/agents`, source: 'user' })
  }
  if (projectPath) {
    dirs.push({ path: `${projectPath}/.claude/agents`, source: 'project' })
    dirs.push({ path: `${projectPath}/.pawn/agents`, source: 'project' })
  }
  // Load low priority first so higher overwrites.
  for (const d of dirs) {
    const loaded = await loadAgentsFromDir(d.path, d.source)
    for (const p of loaded) byName.set(p.name, p)
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export function getBuiltinProfile(name: string): AgentProfile | undefined {
  return BUILTIN_AGENT_PROFILES.find((p) => p.name === name)
}

/** Map legacy mode=explore|worker to profile names. */
export function resolveProfileName(
  agent?: string,
  mode?: string
): string {
  const a = (agent || '').trim().toLowerCase()
  if (a) return a
  const m = (mode || '').trim().toLowerCase()
  if (m === 'worker' || m === 'general-purpose' || m === 'general_purpose') return 'worker'
  if (m === 'plan') return 'plan'
  if (m === 'code-reviewer' || m === 'review') return 'code-reviewer'
  return 'explore'
}

export function thoroughnessMaxRounds(
  base: number,
  thoroughness?: AgentThoroughness
): number {
  if (thoroughness === 'quick') return Math.min(base, 6)
  if (thoroughness === 'very_thorough') return Math.min(25, Math.max(base, 20))
  return base
}

export function thoroughnessHint(thoroughness?: AgentThoroughness): string {
  if (thoroughness === 'quick') {
    return 'Thoroughness: quick — answer with targeted lookups only; stop when you have a confident answer.'
  }
  if (thoroughness === 'very_thorough') {
    return 'Thoroughness: very thorough — cover related modules, edge cases, and cross-references before concluding.'
  }
  return 'Thoroughness: medium — balanced depth; follow important leads without exhaustive tree walks.'
}

/** Normalize agent id for file names / frontmatter. */
export function sanitizeAgentName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function yamlQuote(value: string): string {
  if (/^[\w./+-]+$/.test(value) && !/^(true|false|null|\d+)$/i.test(value)) return value
  return JSON.stringify(value)
}

export type AgentProfileDraft = {
  name: string
  description: string
  systemPrompt: string
  tools?: string[]
  disallowedTools?: string[]
  model: AgentModelPref
  maxTurns: number
  isolation: AgentIsolation
  apply: AgentApplyMode
  thoroughness?: AgentThoroughness
  skills?: string[]
  pathAllow?: string[]
  pathDeny?: string[]
  maxEdits?: number
  maxShell?: number
  maxToolCalls?: number
}

/** Serialize profile to Claude-compatible markdown agent file. */
export function serializeAgentProfile(draft: AgentProfileDraft): string {
  const name = sanitizeAgentName(draft.name)
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${yamlQuote(draft.description.trim() || name)}`,
    `model: ${draft.model || 'inherit'}`,
    `maxTurns: ${Math.min(25, Math.max(1, Math.floor(draft.maxTurns) || 12))}`,
    `isolation: ${draft.isolation === 'worktree' ? 'worktree' : 'none'}`,
    `apply: ${draft.apply === 'auto' ? 'auto' : 'none'}`
  ]
  if (draft.thoroughness) {
    lines.push(`thoroughness: ${draft.thoroughness}`)
  }
  if (draft.skills?.length) {
    lines.push(`skills: ${draft.skills.join(', ')}`)
  }
  if (draft.pathAllow?.length) {
    lines.push(`pathAllow: ${draft.pathAllow.join(', ')}`)
  }
  if (draft.pathDeny?.length) {
    lines.push(`pathDeny: ${draft.pathDeny.join(', ')}`)
  }
  if (draft.maxEdits != null) lines.push(`maxEdits: ${draft.maxEdits}`)
  if (draft.maxShell != null) lines.push(`maxShell: ${draft.maxShell}`)
  if (draft.maxToolCalls != null) lines.push(`maxToolCalls: ${draft.maxToolCalls}`)
  if (draft.tools?.length) {
    lines.push(`tools: ${draft.tools.join(', ')}`)
  }
  if (draft.disallowedTools?.length) {
    lines.push(`disallowedTools: ${draft.disallowedTools.join(', ')}`)
  }
  lines.push('---', '', (draft.systemPrompt || '').trim(), '')
  return lines.join('\n')
}

export function isPawnAgentPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, '/')
  return n.includes('/.pawn/agents/') || n.endsWith('/.pawn/agents')
}

export async function resolveAgentSavePath(
  scope: 'project' | 'user',
  name: string,
  projectPath?: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const id = sanitizeAgentName(name)
  if (!id) return { ok: false, error: 'Invalid agent name' }
  if (scope === 'project') {
    if (!projectPath) return { ok: false, error: 'No project open' }
    return { ok: true, path: `${projectPath}/.pawn/agents/${id}.md` }
  }
  const home = await window.api?.fs?.homeDir?.().catch(() => null)
  if (!home) return { ok: false, error: 'Home directory unavailable' }
  return { ok: true, path: `${home}/.pawn/agents/${id}.md` }
}

/**
 * Write agent markdown under .pawn/agents (project or user).
 * When renaming, pass previousPath to remove the old file if it was a Pawn agent.
 */
export async function saveAgentProfile(opts: {
  draft: AgentProfileDraft
  scope: 'project' | 'user'
  projectPath?: string
  /** Existing file path when editing in place (including .claude agents). */
  existingPath?: string
  previousPath?: string
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const api = window.api?.fs
  if (!api?.writeFile || !api.mkdir) {
    return { ok: false, error: 'File system unavailable' }
  }
  const id = sanitizeAgentName(opts.draft.name)
  if (!id) return { ok: false, error: 'Invalid agent name' }
  if (BUILTIN_AGENT_PROFILES.some((b) => b.name === id) && !opts.existingPath) {
    // Allow override via project/user file (load order wins); warn only if saving over builtin name without path
  }

  let targetPath = opts.existingPath
  if (!targetPath) {
    const resolved = await resolveAgentSavePath(opts.scope, id, opts.projectPath)
    if (!resolved.ok) return resolved
    targetPath = resolved.path
  } else if (isPawnAgentPath(targetPath)) {
    // Keep under .pawn/agents but update filename if name changed
    const dir = targetPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
    targetPath = `${dir}/${id}.md`
  }

  const dir = targetPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
  const mkdirRes = await api.mkdir(dir)
  if (mkdirRes && 'error' in mkdirRes && mkdirRes.error) {
    return { ok: false, error: mkdirRes.error }
  }

  const markdown = serializeAgentProfile({ ...opts.draft, name: id })
  const writeRes = await api.writeFile(targetPath, markdown)
  if (writeRes && 'error' in writeRes && writeRes.error) {
    return { ok: false, error: writeRes.error }
  }

  // Rename cleanup
  const prev = opts.previousPath || opts.existingPath
  if (prev && prev !== targetPath && isPawnAgentPath(prev) && api.delete) {
    try {
      await api.delete(prev)
    } catch {
      /* best effort */
    }
  }
  return { ok: true, path: targetPath }
}

export async function deleteAgentProfile(
  filePath: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPawnAgentPath(filePath)) {
    return {
      ok: false,
      error: 'Only agents under .pawn/agents can be deleted from Pawn (edit .claude agents on disk).'
    }
  }
  const api = window.api?.fs
  if (!api?.delete) return { ok: false, error: 'File system unavailable' }
  const res = await api.delete(filePath)
  if (res && 'error' in res && res.error) return { ok: false, error: res.error }
  return { ok: true }
}

export function profileToDraft(p: AgentProfile): AgentProfileDraft {
  return {
    name: p.name,
    description: p.description,
    systemPrompt: p.systemPrompt,
    tools: p.tools ? [...p.tools] : undefined,
    disallowedTools: p.disallowedTools ? [...p.disallowedTools] : undefined,
    model: p.model,
    maxTurns: p.maxTurns,
    isolation: p.isolation,
    apply: p.apply,
    thoroughness: p.thoroughness,
    skills: p.skills ? [...p.skills] : undefined,
    pathAllow: p.pathAllow ? [...p.pathAllow] : undefined,
    pathDeny: p.pathDeny ? [...p.pathDeny] : undefined,
    maxEdits: p.maxEdits,
    maxShell: p.maxShell,
    maxToolCalls: p.maxToolCalls
  }
}

/** Built-in catalog text (stable; safe to teach the parent without busting cache). */
export function builtinAgentCatalogText(): string {
  return BUILTIN_AGENT_PROFILES.map(
    (p) =>
      `- **${p.name}** — ${p.description} (model=${p.model}, isolation=${p.isolation}` +
      `${p.apply === 'auto' ? ', apply=auto' : ''})`
  ).join('\n')
}
