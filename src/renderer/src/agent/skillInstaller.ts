import { clearProjectContextCache } from './skills'

/**
 * Standard-path skill/plugin installer.
 *
 * Nothing Pawn-specific is created. Skills land in the ecosystem-standard
 * locations so other tools (Claude Code, Codex, OpenAI Agents) see the same
 * files:
 *   user skill   → ~/.agents/skills/<name>/
 *   user plugin  → ~/.claude/plugins/<name>/ + installed_plugins.json entry
 *   project      → <project>/.claude/skills/ or <project>/.claude/plugins/
 *
 * Layouts detected from the cloned repo, in priority order:
 *   plugin (.claude-plugin/plugin.json) → skills/ dir → .claude/skills/ dir →
 *   root SKILL.md.
 */

export type InstallScope = 'user' | 'project'
export type RepoLayout = 'plugin' | 'skills-dir' | 'claude-skills-dir' | 'root-skill' | 'unknown'

export interface RepoProbe {
  hasPluginMarker: boolean
  rootSkill: boolean
  skillsDir: string[]
  claudeSkillsDir: string[]
  hasSetupScript: boolean
}

export function detectRepoLayout(probe: RepoProbe): RepoLayout {
  if (probe.hasPluginMarker) return 'plugin'
  if (probe.skillsDir.length > 0) return 'skills-dir'
  if (probe.claudeSkillsDir.length > 0) return 'claude-skills-dir'
  if (probe.rootSkill) return 'root-skill'
  return 'unknown'
}

/** Last path segment of a GitHub-style URL, sanitized to a safe directory name. */
export function repoNameFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean)
    if (segments.length < 2) return null
    const name = segments[segments.length - 1].replace(/\.git$/i, '')
    return /^[A-Za-z0-9._-]+$/.test(name) ? name : null
  } catch {
    return null
  }
}

/**
 * Merge a user-level plugin into Claude Code's installed_plugins.json without
 * clobbering entries the manifest already holds. Idempotent: re-installing the
 * same installPath leaves the manifest untouched.
 */
export function mergeInstalledPlugins(
  existing: unknown,
  name: string,
  installPath: string
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {}
  const plugins = base.plugins && typeof base.plugins === 'object' && !Array.isArray(base.plugins)
    ? (base.plugins as Record<string, unknown>)
    : {}
  const entries = Array.isArray(plugins[name]) ? (plugins[name] as unknown[]) : []
  if (entries.some((e) => e && typeof e === 'object' && (e as Record<string, unknown>).installPath === installPath)) {
    return base
  }
  return {
    ...base,
    plugins: {
      ...plugins,
      [name]: [...entries, { scope: 'user', installPath }]
    }
  }
}

interface InstallOutcome {
  content: string
  isError?: boolean
}

async function buildProbe(src: string): Promise<RepoProbe> {
  const probe: RepoProbe = {
    hasPluginMarker: false,
    rootSkill: false,
    skillsDir: [],
    claudeSkillsDir: [],
    hasSetupScript: false
  }
  const root = await window.api.fs.listDir(src)
  if (!Array.isArray(root)) return probe

  probe.hasPluginMarker = root.some((e) => e.name === '.claude-plugin' && e.isDirectory)
  probe.rootSkill = root.some((e) => e.name.toLowerCase() === 'skill.md' && !e.isDirectory)

  const safeName = (n: string): boolean => /^[A-Za-z0-9._-]+$/.test(n)
  const skillsRoot = root.find((e) => e.name === 'skills' && e.isDirectory)
  if (skillsRoot) {
    const entries = await window.api.fs.listDir(skillsRoot.path)
    if (Array.isArray(entries)) {
      probe.skillsDir = entries.filter((e) => e.isDirectory && safeName(e.name)).map((e) => e.name)
    }
  }

  const claudeRoot = root.find((e) => e.name === '.claude' && e.isDirectory)
  if (claudeRoot) {
    const entries = await window.api.fs.listDir(`${claudeRoot.path}/skills`)
    if (Array.isArray(entries)) {
      probe.claudeSkillsDir = entries.filter((e) => e.isDirectory && safeName(e.name)).map((e) => e.name)
    }
  }

  const setupDir = root.find((e) => e.name === 'setup' && e.isDirectory)
  if (setupDir) {
    const entries = await window.api.fs.listDir(setupDir.path)
    probe.hasSetupScript = Array.isArray(entries) && entries.some((e) => e.name.toLowerCase() === 'setup.sh')
  }
  return probe
}

export async function installSkillFromRepo(
  repo: string,
  scope: InstallScope,
  projectPath?: string
): Promise<InstallOutcome> {
  if (!/^https?:\/\//i.test(repo)) {
    return { content: 'install_skill requires an http(s) git repository URL.', isError: true }
  }
  const home = await window.api.fs.homeDir().catch(() => null)
  if (!home) return { content: 'Could not resolve the home directory.', isError: true }
  if (scope === 'project' && !projectPath) {
    return { content: 'Project scope needs an active project path. Use scope=user or open a project first.', isError: true }
  }
  const name = repoNameFromUrl(repo)
  if (!name) return { content: `Could not derive a safe repository name from ${repo}`, isError: true }

  const tmp = `${home}/.pawn/tmp/install-${Date.now().toString(36)}`
  const src = `${tmp}/src`
  // execFile passes the URL as a literal argument, so a repo string containing
  // shell metacharacters can never inject into a command line.
  await window.api.fs.mkdir(tmp)
  const clone = await window.api.shell.execFile(
    'git',
    ['clone', '--depth', '1', '--quiet', repo, src],
    tmp,
    120_000
  )
  if (clone.exitCode !== 0) {
    return { content: `git clone failed:\n${(clone.stderr || clone.stdout || '').slice(0, 1500)}`, isError: true }
  }

  try {
    const probe = await buildProbe(src)
    const layout = detectRepoLayout(probe)
    if (layout === 'unknown') {
      return {
        content: 'No SKILL.md or .claude-plugin/plugin.json found in the repository — nothing to install.',
        isError: true
      }
    }

    const targets: string[] = []
    const notes: string[] = []

    if (layout === 'plugin') {
      const dest = scope === 'user'
        ? `${home}/.claude/plugins/${name}`
        : `${projectPath}/.claude/plugins/${name}`
      await window.api.fs.mkdir(dest)
      const copyRes = await window.api.fs.copyDir(src, dest)
      if (copyRes && copyRes.error) return { content: `Copy failed: ${copyRes.error}`, isError: true }
      targets.push(dest)

      if (scope === 'user') {
        const manifestPath = `${home}/.claude/plugins/installed_plugins.json`
        const existing = await window.api.fs.readFile(manifestPath)
        let merged: Record<string, unknown>
        if (typeof existing === 'string') {
          try {
            merged = mergeInstalledPlugins(JSON.parse(existing), name, dest)
          } catch {
            merged = mergeInstalledPlugins(null, name, dest)
          }
        } else {
          merged = mergeInstalledPlugins(null, name, dest)
        }
        const write = await window.api.fs.writeFile(manifestPath, JSON.stringify(merged, null, 2))
        if (write && write.error) notes.push(`manifest write failed: ${write.error}`)
        else notes.push(`registered in ${manifestPath}`)
      }
    } else {
      const dirs = layout === 'skills-dir'
        ? probe.skillsDir
        : layout === 'claude-skills-dir'
          ? probe.claudeSkillsDir
          : [name]
      const targetBase = scope === 'user' ? `${home}/.agents/skills` : `${projectPath}/.claude/skills`
      for (const dirName of dirs) {
        const dest = `${targetBase}/${dirName}`
        await window.api.fs.mkdir(dest)
        const srcDir = layout === 'skills-dir'
          ? `${src}/skills/${dirName}`
          : layout === 'claude-skills-dir'
            ? `${src}/.claude/skills/${dirName}`
            : src
        const copyRes = await window.api.fs.copyDir(srcDir, dest)
        if (copyRes && copyRes.error) {
          notes.push(`${dirName}: copy error ${copyRes.error}`)
          continue
        }
        targets.push(dest)
      }
    }

    clearProjectContextCache()

    const setupNote = (layout === 'plugin' || layout === 'root-skill') && probe.hasSetupScript && targets.length > 0
      ? `\nDependency setup script: ${targets[0]}/setup/setup.sh — run it manually (or ask the agent to run it) if the skill needs packages.`
      : ''

    const lines = [
      `Installed ${layout} "${name}" (scope: ${scope}):`,
      ...targets.map((t) => `  - ${t}`),
      ...notes.map((n) => `  - ${n}`),
      `Layout: ${layout}`,
      setupNote,
      'Skill cache refreshed — Settings > Plugins shows it on next open.'
    ].filter(Boolean)
    return { content: lines.join('\n') }
  } finally {
    await window.api.fs.removeDir(tmp).catch(() => {})
  }
}
