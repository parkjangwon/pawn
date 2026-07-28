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

export function buildSystemPrompt(basePrompt: string, ctx: ProjectContext): string {
  let prompt = basePrompt

  if (ctx.systemAdditions.length > 0) {
    prompt += '\n\n--- Project Context ---\n'
    prompt += ctx.systemAdditions.join('\n\n')
  }

  if (ctx.skills.length > 0) {
    prompt += '\n\n--- Available Skills ---\n'
    for (const skill of ctx.skills) {
      prompt += `\n### ${skill.name}\n${skill.content}\n`
    }
  }

  return prompt
}
