// Load Claude Code compatible skills and context from project directory
// Supports: CLAUDE.md, CLAUDE.local.md, .claude/rules/*.md, .claude/skills/*/SKILL.md

export interface LoadedSkill {
  name: string
  content: string
  source: string
}

export interface ProjectContext {
  systemAdditions: string[]
  skills: LoadedSkill[]
}

export async function loadProjectContext(projectPath: string): Promise<ProjectContext> {
  const api = window.api
  const ctx: ProjectContext = { systemAdditions: [], skills: [] }

  // Load CLAUDE.md
  const claudeMd = await api.fs.readFile(`${projectPath}/CLAUDE.md`)
  if (typeof claudeMd === 'string') {
    ctx.systemAdditions.push(claudeMd)
  }

  // Load CLAUDE.local.md
  const claudeLocalMd = await api.fs.readFile(`${projectPath}/CLAUDE.local.md`)
  if (typeof claudeLocalMd === 'string') {
    ctx.systemAdditions.push(claudeLocalMd)
  }

  // Load .claude/rules/*.md
  const rulesDir = await api.fs.listDir(`${projectPath}/.claude/rules`)
  if (Array.isArray(rulesDir)) {
    for (const entry of rulesDir) {
      if (entry.name.endsWith('.md')) {
        const content = await api.fs.readFile(entry.path)
        if (typeof content === 'string') {
          ctx.systemAdditions.push(content)
        }
      }
    }
  }

  // Load .claude/skills/*/SKILL.md
  const skillsDir = await api.fs.listDir(`${projectPath}/.claude/skills`)
  if (Array.isArray(skillsDir)) {
    for (const skillDir of skillsDir) {
      if (skillDir.isDirectory) {
        const skillFile = await api.fs.readFile(`${skillDir.path}/SKILL.md`)
        if (typeof skillFile === 'string') {
          ctx.skills.push({
            name: skillDir.name,
            content: skillFile,
            source: `${skillDir.path}/SKILL.md`
          })
        }
      }
    }
  }

  // Also check .agent/ directory (Codex-compatible)
  const agentDir = await api.fs.listDir(`${projectPath}/.agent`)
  if (Array.isArray(agentDir)) {
    for (const entry of agentDir) {
      if (entry.name.endsWith('.md')) {
        const content = await api.fs.readFile(entry.path)
        if (typeof content === 'string') {
          ctx.skills.push({
            name: entry.name.replace('.md', ''),
            content,
            source: entry.path
          })
        }
      }
    }
  }

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
export async function readSkill(projectPath: string, name: string): Promise<string | null> {
  const ctx = await loadProjectContext(projectPath)
  const exact = ctx.skills.find((s) => s.name === name)
  if (exact) return exact.content
  const loose = ctx.skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
  return loose ? loose.content : null
}
