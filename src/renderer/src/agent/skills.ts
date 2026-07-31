// Load Claude Code / Codex compatible skills and context.
//
// Project-level sources:
//   CLAUDE.md, CLAUDE.local.md, AGENTS.md
//   .claude/CLAUDE.md, .claude/CLAUDE.local.md, .claude/rules/*.md
//   .claude/skills/*/SKILL.md, .claude/commands/*.md, .claude/agents/*.md
//   .claude/plugins/<name>/{CLAUDE.md, skills/*/SKILL.md, commands/*.md}
//   skills/*/SKILL.md (Agent Skills), .agent/*.md, .agent/skills/*/SKILL.md
//
// User-level sources (~/.claude, when available):
//   CLAUDE.md, CLAUDE.local.md, skills/*/SKILL.md, commands/*.md, and every
//   installed plugin's skills/commands (resolved via installed_plugins.json).

export type SkillKind = 'skill' | 'command' | 'agent' | 'plugin'

export interface LoadedSkill {
  name: string
  content: string
  source: string
  kind: SkillKind
}

export interface ProjectContext {
  systemAdditions: string[]
  skills: LoadedSkill[]
}

const CACHE_TTL = 30_000
const ctxCache = new Map<string, { at: number; ctx: ProjectContext }>()

async function readText(path: string): Promise<string | null> {
  const r = await window.api.fs.readFile(path)
  return typeof r === 'string' ? r : null
}

/** Scan a directory of skill folders, each holding a SKILL.md file. */
async function loadSkillDir(root: string, push: (s: LoadedSkill) => void, kind: SkillKind = 'skill'): Promise<void> {
  const entries = await window.api.fs.listDir(root)
  if (!Array.isArray(entries)) return
  for (const dir of entries) {
    if (!dir.isDirectory) continue
    const content = await readText(`${dir.path}/SKILL.md`)
    if (content) push({ name: dir.name, content, source: `${dir.path}/SKILL.md`, kind })
  }
}

/** Scan <root>/*.md as slash commands / agent definitions. */
async function loadMarkdownDir(root: string, push: (s: LoadedSkill) => void, kind: SkillKind): Promise<void> {
  const entries = await window.api.fs.listDir(root)
  if (!Array.isArray(entries)) return
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.toLowerCase().endsWith('.md')) continue
    const content = await readText(entry.path)
    if (content) push({ name: entry.name.replace(/\.md$/i, ''), content, source: entry.path, kind })
  }
}

/** Scan a plugin directory (installed or project-scoped). */
async function loadPluginDir(pluginDir: string, ctx: ProjectContext): Promise<void> {
  const pluginName = pluginDir.split('/').filter(Boolean).slice(-2, -1)[0] || pluginDir
  const pluginMd = await readText(`${pluginDir}/CLAUDE.md`)
  if (pluginMd) ctx.systemAdditions.push(`[Plugin: ${pluginName}]\n${pluginMd}`)
  await loadSkillDir(`${pluginDir}/skills`, (s) => ctx.skills.push({ ...s, kind: 'plugin' }))
  await loadMarkdownDir(`${pluginDir}/commands`, (s) => ctx.skills.push({ ...s, kind: 'plugin' }), 'plugin')
}

export async function loadProjectContext(projectPath?: string): Promise<ProjectContext> {
  const key = projectPath || '__user__'
  const hit = ctxCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.ctx

  const ctx: ProjectContext = { systemAdditions: [], skills: [] }
  const pushSkill = (s: LoadedSkill): void => { ctx.skills.push(s) }

  // --- User-level (~/.claude) ----------------------------------------------
  const home = await window.api.fs.homeDir().catch(() => null)
  if (home) {
    const userClaude = `${home}/.claude`
    const userMd = await readText(`${userClaude}/CLAUDE.md`)
    if (userMd) ctx.systemAdditions.push(`[User ~/.claude/CLAUDE.md]\n${userMd}`)
    const userLocal = await readText(`${userClaude}/CLAUDE.local.md`)
    if (userLocal) ctx.systemAdditions.push(`[User ~/.claude/CLAUDE.local.md]\n${userLocal}`)
    await loadSkillDir(`${userClaude}/skills`, pushSkill)
    await loadMarkdownDir(`${userClaude}/commands`, pushSkill, 'command')

    // Installed plugins: resolve exact install paths from the manifest rather
    // than walking the whole cache (which also holds marketplace clones).
    const manifest = await readText(`${userClaude}/plugins/installed_plugins.json`)
    if (manifest) {
      try {
        const parsed = JSON.parse(manifest) as { plugins?: Record<string, Array<{ scope?: string; installPath?: string }>> }
        const seen = new Set<string>()
        for (const installs of Object.values(parsed.plugins || {})) {
          for (const inst of installs || []) {
            if (inst.scope === 'user' && inst.installPath && !seen.has(inst.installPath)) {
              seen.add(inst.installPath)
              await loadPluginDir(inst.installPath, ctx)
            }
          }
        }
      } catch {
        // Corrupt manifest — user skills/commands above still work.
      }
    }
  }

  // --- Project-level --------------------------------------------------------
  if (projectPath) {
    const root = projectPath.endsWith('/') ? projectPath : projectPath + '/'
    const dotClaude = `${root}.claude`

    const claudeMd = await readText(`${root}CLAUDE.md`)
    if (claudeMd) ctx.systemAdditions.push(claudeMd)
    const claudeLocal = await readText(`${root}CLAUDE.local.md`)
    if (claudeLocal) ctx.systemAdditions.push(claudeLocal)
    const agentsMd = await readText(`${root}AGENTS.md`)
    if (agentsMd) ctx.systemAdditions.push(agentsMd)

    const dotClaudeMd = await readText(`${dotClaude}/CLAUDE.md`)
    if (dotClaudeMd) ctx.systemAdditions.push(dotClaudeMd)
    const dotClaudeLocal = await readText(`${dotClaude}/CLAUDE.local.md`)
    if (dotClaudeLocal) ctx.systemAdditions.push(dotClaudeLocal)

    // .claude/rules/*.md feed the system context, not the skill list.
    const rulesDir = await window.api.fs.listDir(`${dotClaude}/rules`)
    if (Array.isArray(rulesDir)) {
      for (const entry of rulesDir) {
        if (!entry.isDirectory && entry.name.toLowerCase().endsWith('.md')) {
          const content = await readText(entry.path)
          if (content) ctx.systemAdditions.push(content)
        }
      }
    }

    await loadSkillDir(`${dotClaude}/skills`, pushSkill)
    await loadMarkdownDir(`${dotClaude}/commands`, pushSkill, 'command')
    await loadMarkdownDir(`${dotClaude}/agents`, pushSkill, 'agent')
    await loadSkillDir(`${root}skills`, pushSkill)
    await loadMarkdownDir(`${root}.agent`, pushSkill, 'agent')
    await loadSkillDir(`${root}.agent/skills`, pushSkill)

    // Project-scoped plugins (.claude/plugins/<name>/).
    const projPlugins = await window.api.fs.listDir(`${dotClaude}/plugins`)
    if (Array.isArray(projPlugins)) {
      for (const entry of projPlugins) {
        if (entry.isDirectory) await loadPluginDir(entry.path, ctx)
      }
    }
  }

  // Project scope wins over user scope on name collisions (it loads last).
  const seen = new Set<string>()
  ctx.skills = ctx.skills.filter((s) => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })

  ctxCache.set(key, { at: Date.now(), ctx })
  return ctx
}

/** First meaningful line of a skill file — its front-matter description or heading. */
export function skillSummary(skill: LoadedSkill): string {
  const lines = skill.content.split('\n')
  // Prefer a YAML front-matter `description:` when present.
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
      const m = lines[i].match(/^description:\s*(.+)$/i)
      if (m) return m[1].replace(/^["']|["']$/g, '').trim().slice(0, 160)
    }
  }
  const firstProse = lines
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('---') && !l.startsWith('#') && !l.includes(':'))
  return (firstProse || '').slice(0, 160)
}

/**
 * Serialize the project-scoped context (CLAUDE.md, rules, skills) into a
 * standalone block, kept separate from the global base prompt so that base layer
 * stays byte-identical across every project and session.
 *
 * Skills are listed by name and summary only. Inlining every SKILL.md body used
 * to push tens of thousands of tokens into the system prompt of every single
 * request, for skills the model never invoked. The body is fetched on demand
 * through the `load_skill` tool.
 */
export function buildProjectContextBlock(ctx: ProjectContext): string {
  const parts: string[] = []

  if (ctx.systemAdditions.length > 0) {
    parts.push('--- Project Context ---\n' + ctx.systemAdditions.join('\n\n'))
  }

  if (ctx.skills.length > 0) {
    const lines = ctx.skills.map((s) => {
      const summary = skillSummary(s)
      return summary ? `- ${s.name}: ${summary}` : `- ${s.name}`
    })
    parts.push(
      '--- Available Skills ---\n' +
      'Call load_skill with the name to read the full instructions before following one.\n' +
      lines.join('\n')
    )
  }

  return parts.join('\n\n')
}

/** Resolve a skill body by name for the `load_skill` tool. */
export async function readSkill(projectPath: string | undefined, name: string): Promise<string | null> {
  const ctx = await loadProjectContext(projectPath)
  const exact = ctx.skills.find((s) => s.name === name)
  if (exact) return exact.content
  const loose = ctx.skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
  return loose ? loose.content : null
}
