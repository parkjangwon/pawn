import { useCallback, useEffect, useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { tx } from '../i18n'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import { useProviderStore, type SubagentCostMode } from '../stores/provider'
import { harnessProfile } from '../agent/harnessMode'
import {
  loadAgentProfiles,
  profileToDraft,
  saveAgentProfile,
  deleteAgentProfile,
  sanitizeAgentName,
  isPawnAgentPath,
  type AgentProfile,
  type AgentProfileDraft,
  type AgentIsolation,
  type AgentApplyMode,
  type AgentThoroughness,
  type AgentModelPref
} from '../agent/agentProfiles'
import './AgentsSettingsPanel.css'
import Input, { Textarea } from './Input'
import Select from './Select'

type EditorMode = 'closed' | 'create' | 'edit'

const emptyDraft = (): AgentProfileDraft => ({
  name: '',
  description: '',
  systemPrompt: '',
  tools: undefined,
  disallowedTools: undefined,
  model: 'inherit',
  maxTurns: 12,
  isolation: 'none',
  apply: 'none',
  thoroughness: undefined,
  skills: undefined,
  pathAllow: undefined,
  pathDeny: undefined,
  maxEdits: undefined,
  maxShell: undefined,
  maxToolCalls: undefined
})

const TEMPLATES: Array<{
  id: string
  draft: AgentProfileDraft
}> = [
  {
    id: 'research',
    draft: {
      name: 'research-specialist',
      description: 'Deep read-only investigation of a subsystem; returns findings and paths.',
      systemPrompt:
        'You are a research specialist.\nMap the assigned area thoroughly.\n- Prefer repo_map → codebase_search → read_file.\n- Do not edit or run mutating shell.\n- Return: findings, key paths, open questions.',
      model: 'simple',
      maxTurns: 12,
      isolation: 'none',
      apply: 'none',
      thoroughness: 'medium'
    }
  },
  {
    id: 'implementer',
    draft: {
      name: 'focused-implementer',
      description: 'Isolated implementer for a single multi-step coding task.',
      systemPrompt:
        'You are a focused implementer.\nComplete ONLY the assigned task with minimal diffs.\n- Prefer edit_file; run_checks after edits.\n- Summarize changes, verification, residual risks.',
      model: 'inherit',
      maxTurns: 18,
      isolation: 'worktree',
      apply: 'auto',
      pathDeny: ['.env', '.env.*', '**/secrets/**'],
      maxEdits: 40,
      maxShell: 10,
      maxToolCalls: 80
    }
  },
  {
    id: 'reviewer',
    draft: {
      name: 'strict-reviewer',
      description: 'Read-only code review with severity-ranked issues.',
      systemPrompt:
        'You are a strict code reviewer.\nFor each issue: severity (blocker/major/minor), location, why, fix.\nFocus on correctness, security, edge cases.\nEnd with a prioritized action list.',
      model: 'mid',
      maxTurns: 10,
      isolation: 'none',
      apply: 'none',
      tools: [
        'read_file',
        'list_dir',
        'search_files',
        'grep_search',
        'codebase_search',
        'repo_map',
        'git_status',
        'git_diff',
        'git_log',
        'run_checks',
        'load_skill'
      ]
    }
  }
]

function listToText(list?: string[]): string {
  return list?.join(', ') || ''
}

function textToList(text: string): string[] | undefined {
  const parts = text
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts : undefined
}

function profileInitial(name: string): string {
  return (name || '?').slice(0, 1).toUpperCase()
}

export default function AgentsSettingsPanel(): React.JSX.Element {
  const projectPath = useAppStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId)
    return getEffectiveProjectPath(p, useAppStore.getState().activeSessionId)
  })
  const subagentCostMode = useProviderStore((s) => s.subagentCostMode)
  const setSubagentCostMode = useProviderStore((s) => s.setSubagentCostMode)
  const maxParallelSubagents = useProviderStore((s) => s.maxParallelSubagents)
  const setMaxParallelSubagents = useProviderStore((s) => s.setMaxParallelSubagents)
  const autoOpenAgentsPanel = useProviderStore((s) => s.autoOpenAgentsPanel)
  const setAutoOpenAgentsPanel = useProviderStore((s) => s.setAutoOpenAgentsPanel)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AgentProfile | null>(null)
  const [query, setQuery] = useState('')

  const [editorMode, setEditorMode] = useState<EditorMode>('closed')
  const [draft, setDraft] = useState<AgentProfileDraft>(emptyDraft)
  const [scope, setScope] = useState<'project' | 'user'>('project')
  const [existingPath, setExistingPath] = useState<string | undefined>()
  const [originalName, setOriginalName] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [toolsText, setToolsText] = useState('')
  const [denyText, setDenyText] = useState('')
  const [skillsText, setSkillsText] = useState('')
  const [pathAllowText, setPathAllowText] = useState('')
  const [pathDenyText, setPathDenyText] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await loadAgentProfiles(projectPath || undefined)
      setProfiles(list)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q)
    )
  }, [profiles, query])

  const builtins = useMemo(() => filtered.filter((p) => p.source === 'builtin'), [filtered])
  const custom = useMemo(() => filtered.filter((p) => p.source !== 'builtin'), [filtered])

  const openCreate = (from?: AgentProfileDraft): void => {
    const d = from ? { ...from } : emptyDraft()
    setDraft(d)
    setToolsText(listToText(d.tools))
    setDenyText(listToText(d.disallowedTools))
    setSkillsText(listToText(d.skills))
    setPathAllowText(listToText(d.pathAllow))
    setPathDenyText(listToText(d.pathDeny))
    setExistingPath(undefined)
    setOriginalName('')
    setScope(projectPath ? 'project' : 'user')
    setEditorMode('create')
    setMessage(null)
    setError(null)
  }

  const openEdit = (p: AgentProfile): void => {
    const d = profileToDraft(p)
    setDraft(d)
    setToolsText(listToText(d.tools))
    setDenyText(listToText(d.disallowedTools))
    setSkillsText(listToText(d.skills))
    setPathAllowText(listToText(d.pathAllow))
    setPathDenyText(listToText(d.pathDeny))
    setExistingPath(p.sourcePath)
    setOriginalName(p.name)
    setScope(p.source === 'user' ? 'user' : 'project')
    setEditorMode(p.source === 'builtin' ? 'create' : 'edit')
    if (p.source === 'builtin') {
      setExistingPath(undefined)
      setDraft({
        ...d,
        name: `${p.name}-custom`,
        description: d.description
      })
      setOriginalName('')
    }
    setMessage(null)
    setError(null)
  }

  const closeEditor = (): void => {
    setEditorMode('closed')
    setDraft(emptyDraft())
    setExistingPath(undefined)
  }

  const handleSave = async (): Promise<void> => {
    const name = sanitizeAgentName(draft.name)
    if (!name) {
      setError('Enter a valid agent name.')
      return
    }
    if (!draft.systemPrompt.trim()) {
      setError('Instructions are required.')
      return
    }
    if (scope === 'project' && !projectPath && !existingPath) {
      setError('Open a project to save for this project, or choose “This device”.')
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const full: AgentProfileDraft = {
        ...draft,
        name,
        tools: textToList(toolsText),
        disallowedTools: textToList(denyText),
        skills: textToList(skillsText),
        pathAllow: textToList(pathAllowText),
        pathDeny: textToList(pathDenyText),
        maxEdits: draft.maxEdits,
        maxShell: draft.maxShell,
        maxToolCalls: draft.maxToolCalls
      }
      const res = await saveAgentProfile({
        draft: full,
        scope,
        projectPath: projectPath || undefined,
        existingPath: editorMode === 'edit' ? existingPath : undefined,
        previousPath:
          editorMode === 'edit' &&
          existingPath &&
          isPawnAgentPath(existingPath) &&
          sanitizeAgentName(originalName) !== name
            ? existingPath
            : undefined
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setMessage(`Saved to ${res.path}`)
      closeEditor()
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  // Deletion is staged behind a ConfirmDialog; the actual work happens here.
  const handleDelete = async (p: AgentProfile): Promise<void> => {
    if (!p.sourcePath) return
    setPendingDelete(null)
    try {
      const res = await deleteAgentProfile(p.sourcePath)
      if (!res.ok) {
        setError(res.error || 'Something failed — see the console for details.')
        return
      }
      setMessage(`Deleted ${p.name}`)
      if (editorMode !== 'closed' && existingPath === p.sourcePath) closeEditor()
      await refresh()
    } catch (e) {
      console.warn('[agents-settings]', e)
      setError('Something failed — see the console for details.')
    }
  }

  const requestDelete = (p: AgentProfile): void => {
    if (!p.sourcePath || !isPawnAgentPath(p.sourcePath)) {
      setError('You can edit Claude Code agents here, but only Pawn-saved agents can be deleted from this screen.')
      return
    }
    setPendingDelete(p)
  }

  const patchDraft = <K extends keyof AgentProfileDraft>(
    key: K,
    value: AgentProfileDraft[K]
  ): void => {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const renderCard = (p: AgentProfile, isCustom: boolean): React.JSX.Element => (
    <li key={`${p.source}:${p.name}:${p.sourcePath || ''}`} className="agents-card">
      <div className="agents-card-top">
        <div className={`agents-avatar source-${p.source}`} aria-hidden>
          {profileInitial(p.name)}
        </div>
        <div className="agents-card-head">
          <div className="agents-settings-name">
            <strong>{p.name}</strong>
            <span className="agents-settings-tag">
              {isCustom ? p.source : 'Built-in'}
            </span>
            {p.isolation === 'worktree' && (
              <span className="agents-settings-tag soft">worktree</span>
            )}
            {p.apply === 'auto' && <span className="agents-settings-tag soft">apply</span>}
            {p.skills?.length ? (
              <span className="agents-settings-tag soft">skills×{p.skills.length}</span>
            ) : null}
          </div>
          <div className="agents-settings-desc">
            {isCustom
              ? p.description
              : tx(`settings.agentsSection.builtinDesc_${p.name}`, { defaultValue: p.description })}
          </div>
        </div>
      </div>
      <div className="agents-settings-meta">
        {`Model: ${p.model || 'Same as main chat'} · Max steps: ${p.maxTurns}`}
        {p.sourcePath ? ` · ${p.sourcePath}` : ''}
      </div>
      <div className="agents-card-actions">
        {isCustom ? (
          <>
            <button type="button" className="agents-link-btn" onClick={() => openEdit(p)}>
              {'Edit'}
            </button>
            {p.sourcePath && isPawnAgentPath(p.sourcePath) && (
              <button
                type="button"
                className="agents-link-btn danger"
                onClick={() => requestDelete(p)}
              >
                {'Delete'}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="agents-link-btn" onClick={() => openEdit(p)}>
            {'Copy as custom'}
          </button>
        )}
      </div>
    </li>
  )

  return (
    <div className="agents-settings">
      {pendingDelete && (
        <ConfirmDialog
          title={'Delete this agent?'}
          message={`Delete “${pendingDelete.name}”? This cannot be undone.`}
          confirmLabel={'Delete'}
          danger
          onConfirm={() => void handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <div className="agents-settings-head">
        <div>
          <p className="settings-desc">{'Build specialized helpers the main chat can hand work off to—research, planning, implementation, review, and more. Pawn ships with ready-made roles; yours are saved with the project or on this device.'}</p>
          <p className="agents-settings-subhint">{'When work can be split up, Pawn can run several helpers at the same time (up to six) so independent tasks finish faster. Watch them live in the chat, or open the Agents panel for full history.'}</p>
        </div>
        <div className="agents-settings-head-actions">
          <button type="button" className="agents-settings-refresh" onClick={() => void refresh()}>
            {'Refresh'}
          </button>
          <button type="button" className="agents-settings-primary" onClick={() => openCreate()}>
            {'New agent'}
          </button>
        </div>
      </div>

      <div className="agents-cost-mode settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Cost preference'}</span>
            <span className="settings-row-desc">{'Default model budget when helpers run. A stronger model set on a specific agent still wins.'}</span>
          </div>
          <div className="theme-toggle agents-cost-toggle">
            {(
              [
                ['frugal', 'settings.agentsSection.costFrugal', 'settings.agentsSection.costFrugalDesc'],
                [
                  'balanced',
                  'settings.agentsSection.costBalanced',
                  'settings.agentsSection.costBalancedDesc'
                ],
                [
                  'quality',
                  'settings.agentsSection.costQuality',
                  'settings.agentsSection.costQualityDesc'
                ]
              ] as const
            ).map(([mode, labelKey, descKey]) => (
              <button
                key={mode}
                type="button"
                className={subagentCostMode === mode ? 'active' : ''}
                title={tx(descKey)}
                onClick={() => setSubagentCostMode(mode as SubagentCostMode)}
              >
                {tx(labelKey)}
              </button>
            ))}
          </div>
        </div>
        <p className="agents-cost-hint">
          {subagentCostMode === 'frugal'
            ? 'Prefer cheaper models. Research stays light; implementers may use a mid-tier model. No automatic upgrades.'
            : subagentCostMode === 'quality'
              ? 'Use the best available model when it helps. Still reuses cached context to limit cost when possible.'
              : 'Recommended. Light research, mid-tier planning/review, freer choice for implementers—within safe bounds.'}
        </p>

        <div className="agents-perf-block">
          <div className="settings-row agents-perf-settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{'Run at once'}</span>
              <span className="settings-row-desc">{'How many agents can work side by side. Extra jobs wait in line.'}</span>
              <span className="settings-row-desc">
                {`Applies in Default mode. Eco uses ${harnessProfile('eco').parallelPool}, Maxing uses ${harnessProfile('maxing').parallelPool}.`}
              </span>
            </div>
            <div
              className="theme-toggle agents-pool-toggle"
              role="group"
              aria-label={'Run at once'}
            >
              {([1, 2, 3, 4, 5, 6] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={maxParallelSubagents === n ? 'active' : ''}
                  onClick={() => setMaxParallelSubagents(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row agents-perf-settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{'Show helper progress in chat'}</span>
              <span className="settings-row-desc">{'Show a compact activity bar in the chat while helpers work, and expand it to see what each one is doing.'}</span>
            </div>
            <label className="agents-switch">
              <input
                type="checkbox"
                checked={autoOpenAgentsPanel}
                aria-label={'Show helper progress in chat'}
                onChange={(e) => setAutoOpenAgentsPanel(e.target.checked)}
              />
              <span className="agents-switch-track" aria-hidden />
            </label>
          </div>
        </div>
      </div>

      <div className="agents-search-row">
        <Input
          className="agents-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={'Search agents…'}
          aria-label={'Search agents…'}
        />
      </div>

      {editorMode === 'closed' && (
        <div className="agents-templates">
          <div className="agents-templates-label">{'Start from a template'}</div>
          <div className="agents-templates-row">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="agents-template-chip"
                onClick={() => openCreate(tpl.draft)}
              >
                {tx(`settings.agentsSection.template_${tpl.id}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="agents-settings-muted">{'Loading…'}</div>
      )}
      {error && <div className="agents-settings-error">{error}</div>}
      {message && <div className="agents-settings-ok">{message}</div>}

      {editorMode !== 'closed' && (
        <div className="agents-editor">
          <div className="agents-editor-title">
            {editorMode === 'create'
              ? 'Create agent'
              : `Edit ${originalName || draft.name}`}
          </div>

          <label className="agents-field">
            <span>{'Name'}</span>
            <Input
              value={draft.name}
              onChange={(e) => patchDraft('name', e.target.value)}
              placeholder="security-audit"
              disabled={editorMode === 'edit' && !!existingPath && !isPawnAgentPath(existingPath)}
            />
            <span className="agents-field-hint">{'Lowercase letters, numbers, and hyphens. Stored as a small file under .pawn/agents.'}</span>
          </label>

          <label className="agents-field">
            <span>{'When to use'}</span>
            <Input
              value={draft.description}
              onChange={(e) => patchDraft('description', e.target.value)}
              placeholder={'When should the main chat pick this agent?'}
            />
          </label>

          <label className="agents-field">
            <span>{'Instructions'}</span>
            <Textarea
              value={draft.systemPrompt}
              onChange={(e) => patchDraft('systemPrompt', e.target.value)}
              rows={8}
              placeholder={'You are a specialist that…'}
            />
          </label>

          <div className="agents-field-row">
            <label className="agents-field">
              <span>{'Model preference'}</span>
              <Select
                value={draft.model}
                onChange={(e) => patchDraft('model', e.target.value as AgentModelPref)}
              >
                <option value="inherit">{'Same as main chat'}</option>
                <option value="simple">{'Faster / lower cost'}</option>
                <option value="mid">{'Balanced'}</option>
                <option value="complex">{'Strongest'}</option>
              </Select>
            </label>
            <label className="agents-field">
              <span>{'Max steps'}</span>
              <Input
                type="number"
                min={1}
                max={25}
                value={draft.maxTurns}
                onChange={(e) =>
                  patchDraft('maxTurns', Math.min(25, Math.max(1, Number(e.target.value) || 12)))
                }
              />
            </label>
          </div>

          <div className="agents-field-row">
            <label className="agents-field">
              <span>{'Workspace'}</span>
              <Select
                value={draft.isolation}
                onChange={(e) => {
                  const isolation = e.target.value as AgentIsolation
                  patchDraft('isolation', isolation)
                  if (isolation === 'worktree' && draft.apply === 'none') {
                    patchDraft('apply', 'auto')
                  }
                }}
              >
                <option value="none">{'Shared with project'}</option>
                <option value="worktree">{'Isolated copy (git worktree)'}</option>
              </Select>
            </label>
            <label className="agents-field">
              <span>{'Bring changes back'}</span>
              <Select
                value={draft.apply}
                onChange={(e) => patchDraft('apply', e.target.value as AgentApplyMode)}
              >
                <option value="none">{'Discard when done'}</option>
                <option value="auto">{'Merge into project'}</option>
                <option value="review">{'Review before applying'}</option>
              </Select>
            </label>
            <label className="agents-field">
              <span>{'Depth'}</span>
              <Select
                value={draft.thoroughness || ''}
                onChange={(e) =>
                  patchDraft(
                    'thoroughness',
                    (e.target.value || undefined) as AgentThoroughness | undefined
                  )
                }
              >
                <option value="">{'Default'}</option>
                <option value="quick">{'Quick'}</option>
                <option value="medium">{'Balanced'}</option>
                <option value="very_thorough">{'Very thorough'}</option>
              </Select>
            </label>
          </div>

          <label className="agents-field">
            <span>{'Skills to load (optional)'}</span>
            <Input
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
              placeholder="pdf, git-helpers"
            />
            <span className="agents-field-hint">{'Comma-separated skill names. Their guides are loaded for this agent only.'}</span>
          </label>

          <label className="agents-field">
            <span>{'Editable paths (optional)'}</span>
            <Input
              value={pathAllowText}
              onChange={(e) => setPathAllowText(e.target.value)}
              placeholder="src/**, package.json"
            />
            <span className="agents-field-hint">{'Only these paths may be edited (e.g. src/**). Leave empty to allow anything not blocked below.'}</span>
          </label>

          <label className="agents-field">
            <span>{'Blocked paths (optional)'}</span>
            <Input
              value={pathDenyText}
              onChange={(e) => setPathDenyText(e.target.value)}
              placeholder=".env, .env.*, **/secrets/**"
            />
            <span className="agents-field-hint">{'Never touch these paths (e.g. .env, secrets folders).'}</span>
          </label>

          <div className="agents-field-row">
            <label className="agents-field">
              <span>{'Max file edits'}</span>
              <Input
                type="number"
                min={1}
                max={200}
                value={draft.maxEdits ?? ''}
                placeholder="48"
                onChange={(e) =>
                  patchDraft(
                    'maxEdits',
                    e.target.value === '' ? undefined : Math.max(1, Number(e.target.value) || 1)
                  )
                }
              />
            </label>
            <label className="agents-field">
              <span>{'Max shell runs'}</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={draft.maxShell ?? ''}
                placeholder="12"
                onChange={(e) =>
                  patchDraft(
                    'maxShell',
                    e.target.value === '' ? undefined : Math.max(1, Number(e.target.value) || 1)
                  )
                }
              />
            </label>
            <label className="agents-field">
              <span>{'Max tool uses'}</span>
              <Input
                type="number"
                min={1}
                max={300}
                value={draft.maxToolCalls ?? ''}
                placeholder="100"
                onChange={(e) =>
                  patchDraft(
                    'maxToolCalls',
                    e.target.value === '' ? undefined : Math.max(1, Number(e.target.value) || 1)
                  )
                }
              />
            </label>
          </div>

          <label className="agents-field">
            <span>{'Allowed tools (optional)'}</span>
            <Textarea
              value={toolsText}
              onChange={(e) => setToolsText(e.target.value)}
              rows={2}
              placeholder="read_file, grep_search, repo_map"
            />
            <span className="agents-field-hint">{'Comma-separated tool names. Leave empty to allow the usual set (minus anything you deny below).'}</span>
          </label>

          <label className="agents-field">
            <span>{'Blocked tools (optional)'}</span>
            <Textarea
              value={denyText}
              onChange={(e) => setDenyText(e.target.value)}
              rows={2}
              placeholder="spawn_agent, shell_exec"
            />
          </label>

          {editorMode === 'create' && (
            <label className="agents-field">
              <span>{'Save to'}</span>
              <Select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'project' | 'user')}
              >
                <option value="project" disabled={!projectPath}>
                  {'This project'}
                  {!projectPath ? ` (${'open a project first'})` : ''}
                </option>
                <option value="user">{'This device (all projects)'}</option>
              </Select>
            </label>
          )}

          {existingPath && (
            <div className="agents-settings-meta">
              {'File'}: {existingPath}
            </div>
          )}

          <div className="agents-editor-actions">
            <button
              type="button"
              className="agents-settings-primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="agents-settings-refresh" onClick={closeEditor}>
              {'Cancel'}
            </button>
          </div>
        </div>
      )}

      <h4 className="agents-settings-h">
        {'Built-in'} ({builtins.length})
      </h4>
      <ul className="agents-settings-list agents-grid">
        {builtins.map((p) => renderCard(p, false))}
      </ul>

      <h4 className="agents-settings-h">
        {'Custom'} ({custom.length})
      </h4>
      {custom.length === 0 ? (
        <div className="agents-settings-muted">{'No custom agents yet. Tap “New agent”, or copy a built-in role and tweak it.'}</div>
      ) : (
        <ul className="agents-settings-list agents-grid">
          {custom.map((p) => renderCard(p, true))}
        </ul>
      )}
    </div>
  )
}
