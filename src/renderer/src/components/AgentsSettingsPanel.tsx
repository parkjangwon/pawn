import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app'
import { useProviderStore, type SubagentCostMode } from '../stores/provider'
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
  const { t } = useTranslation()
  const projectPath = useAppStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId)
    return p?.paths?.[0] || ''
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
      setError(t('settings.agentsSection.errName'))
      return
    }
    if (!draft.systemPrompt.trim()) {
      setError(t('settings.agentsSection.errPrompt'))
      return
    }
    if (scope === 'project' && !projectPath && !existingPath) {
      setError(t('settings.agentsSection.errNoProject'))
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
      setMessage(t('settings.agentsSection.saved', { path: res.path }))
      closeEditor()
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p: AgentProfile): Promise<void> => {
    if (!p.sourcePath || !isPawnAgentPath(p.sourcePath)) {
      setError(t('settings.agentsSection.errDeleteClaude'))
      return
    }
    const ok = window.confirm(t('settings.agentsSection.confirmDelete', { name: p.name }))
    if (!ok) return
    setError(null)
    const res = await deleteAgentProfile(p.sourcePath)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(t('settings.agentsSection.deleted', { name: p.name }))
    if (editorMode !== 'closed' && existingPath === p.sourcePath) closeEditor()
    await refresh()
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
              {isCustom ? p.source : t('settings.agentsSection.builtin')}
            </span>
            {p.isolation === 'worktree' && (
              <span className="agents-settings-tag soft">worktree</span>
            )}
            {p.apply === 'auto' && <span className="agents-settings-tag soft">apply</span>}
            {p.skills?.length ? (
              <span className="agents-settings-tag soft">skills×{p.skills.length}</span>
            ) : null}
          </div>
          <div className="agents-settings-desc">{p.description}</div>
        </div>
      </div>
      <div className="agents-settings-meta">
        model={p.model} · maxTurns={p.maxTurns}
        {p.sourcePath ? ` · ${p.sourcePath}` : ''}
      </div>
      <div className="agents-card-actions">
        {isCustom ? (
          <>
            <button type="button" className="agents-link-btn" onClick={() => openEdit(p)}>
              {t('settings.agentsSection.edit')}
            </button>
            {p.sourcePath && isPawnAgentPath(p.sourcePath) && (
              <button
                type="button"
                className="agents-link-btn danger"
                onClick={() => void handleDelete(p)}
              >
                {t('settings.agentsSection.delete')}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="agents-link-btn" onClick={() => openEdit(p)}>
            {t('settings.agentsSection.duplicate')}
          </button>
        )}
      </div>
    </li>
  )

  return (
    <div className="agents-settings">
      <div className="agents-settings-head">
        <div>
          <p className="settings-row-desc">{t('settings.agentsSection.desc')}</p>
          <p className="agents-settings-subhint">{t('settings.agentsSection.parallelHint')}</p>
        </div>
        <div className="agents-settings-head-actions">
          <button type="button" className="agents-settings-refresh" onClick={() => void refresh()}>
            {t('settings.agentsSection.refresh')}
          </button>
          <button type="button" className="agents-settings-primary" onClick={() => openCreate()}>
            {t('settings.agentsSection.new')}
          </button>
        </div>
      </div>

      <div className="agents-cost-mode settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{t('settings.agentsSection.costMode')}</span>
            <span className="settings-row-desc">{t('settings.agentsSection.costModeDesc')}</span>
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
                title={t(descKey)}
                onClick={() => setSubagentCostMode(mode as SubagentCostMode)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
        <p className="agents-cost-hint">
          {subagentCostMode === 'frugal'
            ? t('settings.agentsSection.costFrugalDesc')
            : subagentCostMode === 'quality'
              ? t('settings.agentsSection.costQualityDesc')
              : t('settings.agentsSection.costBalancedDesc')}
        </p>

        <div className="agents-perf-block">
          <div className="settings-row agents-perf-settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{t('settings.agentsSection.maxParallel')}</span>
              <span className="settings-row-desc">{t('settings.agentsSection.maxParallelDesc')}</span>
            </div>
            <div
              className="theme-toggle agents-pool-toggle"
              role="group"
              aria-label={t('settings.agentsSection.maxParallel')}
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
              <span className="settings-row-label">{t('settings.agentsSection.autoOpenPanel')}</span>
              <span className="settings-row-desc">{t('settings.agentsSection.autoOpenPanelDesc')}</span>
            </div>
            <label className="agents-switch">
              <input
                type="checkbox"
                checked={autoOpenAgentsPanel}
                onChange={(e) => setAutoOpenAgentsPanel(e.target.checked)}
              />
              <span className="agents-switch-track" aria-hidden />
            </label>
          </div>
        </div>
      </div>

      <div className="agents-search-row">
        <input
          className="agents-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.agentsSection.searchPh')}
          aria-label={t('settings.agentsSection.searchPh')}
        />
      </div>

      {editorMode === 'closed' && (
        <div className="agents-templates">
          <div className="agents-templates-label">{t('settings.agentsSection.templates')}</div>
          <div className="agents-templates-row">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="agents-template-chip"
                onClick={() => openCreate(tpl.draft)}
              >
                {t(`settings.agentsSection.template_${tpl.id}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="agents-settings-muted">{t('settings.agentsSection.loading')}</div>
      )}
      {error && <div className="agents-settings-error">{error}</div>}
      {message && <div className="agents-settings-ok">{message}</div>}

      {editorMode !== 'closed' && (
        <div className="agents-editor">
          <div className="agents-editor-title">
            {editorMode === 'create'
              ? t('settings.agentsSection.editorCreate')
              : t('settings.agentsSection.editorEdit', { name: originalName || draft.name })}
          </div>

          <label className="agents-field">
            <span>{t('settings.agentsSection.fieldName')}</span>
            <input
              value={draft.name}
              onChange={(e) => patchDraft('name', e.target.value)}
              placeholder="security-audit"
              disabled={editorMode === 'edit' && !!existingPath && !isPawnAgentPath(existingPath)}
            />
            <span className="agents-field-hint">{t('settings.agentsSection.fieldNameHint')}</span>
          </label>

          <label className="agents-field">
            <span>{t('settings.agentsSection.fieldDescription')}</span>
            <input
              value={draft.description}
              onChange={(e) => patchDraft('description', e.target.value)}
              placeholder={t('settings.agentsSection.fieldDescriptionPh')}
            />
          </label>

          <label className="agents-field">
            <span>{t('settings.agentsSection.fieldPrompt')}</span>
            <textarea
              value={draft.systemPrompt}
              onChange={(e) => patchDraft('systemPrompt', e.target.value)}
              rows={8}
              placeholder={t('settings.agentsSection.fieldPromptPh')}
            />
          </label>

          <div className="agents-field-row">
            <label className="agents-field">
              <span>{t('settings.agentsSection.fieldModel')}</span>
              <select
                value={draft.model}
                onChange={(e) => patchDraft('model', e.target.value as AgentModelPref)}
              >
                <option value="inherit">{t('settings.agentsSection.modelInherit')}</option>
                <option value="simple">{t('settings.agentsSection.modelSimple')}</option>
                <option value="mid">{t('settings.agentsSection.modelMid')}</option>
                <option value="complex">{t('settings.agentsSection.modelComplex')}</option>
              </select>
            </label>
            <label className="agents-field">
              <span>{t('settings.agentsSection.fieldMaxTurns')}</span>
              <input
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
              <span>{t('settings.agentsSection.fieldIsolation')}</span>
              <select
                value={draft.isolation}
                onChange={(e) => {
                  const isolation = e.target.value as AgentIsolation
                  patchDraft('isolation', isolation)
                  if (isolation === 'worktree' && draft.apply === 'none') {
                    patchDraft('apply', 'auto')
                  }
                }}
              >
                <option value="none">{t('settings.agentsSection.isolationNone')}</option>
                <option value="worktree">{t('settings.agentsSection.isolationWorktree')}</option>
              </select>
            </label>
            <label className="agents-field">
              <span>{t('settings.agentsSection.fieldApply')}</span>
              <select
                value={draft.apply}
                onChange={(e) => patchDraft('apply', e.target.value as AgentApplyMode)}
              >
                <option value="none">{t('settings.agentsSection.applyNone')}</option>
                <option value="auto">{t('settings.agentsSection.applyAuto')}</option>
                <option value="review">{t('settings.agentsSection.applyReview')}</option>
              </select>
            </label>
            <label className="agents-field">
              <span>{t('settings.agentsSection.fieldThoroughness')}</span>
              <select
                value={draft.thoroughness || ''}
                onChange={(e) =>
                  patchDraft(
                    'thoroughness',
                    (e.target.value || undefined) as AgentThoroughness | undefined
                  )
                }
              >
                <option value="">{t('settings.agentsSection.thoroughnessDefault')}</option>
                <option value="quick">{t('settings.agentsSection.thoroughnessQuick')}</option>
                <option value="medium">{t('settings.agentsSection.thoroughnessMedium')}</option>
                <option value="very_thorough">{t('settings.agentsSection.thoroughnessDeep')}</option>
              </select>
            </label>
          </div>

          <label className="agents-field">
            <span>{t('settings.agentsSection.fieldSkills')}</span>
            <input
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
              placeholder="pdf, git-helpers"
            />
            <span className="agents-field-hint">{t('settings.agentsSection.fieldSkillsHint')}</span>
          </label>

          <label className="agents-field">
            <span>{t('settings.agentsSection.fieldPathAllow')}</span>
            <input
              value={pathAllowText}
              onChange={(e) => setPathAllowText(e.target.value)}
              placeholder="src/**, package.json"
            />
            <span className="agents-field-hint">{t('settings.agentsSection.fieldPathAllowHint')}</span>
          </label>

          <label className="agents-field">
            <span>{t('settings.agentsSection.fieldPathDeny')}</span>
            <input
              value={pathDenyText}
              onChange={(e) => setPathDenyText(e.target.value)}
              placeholder=".env, .env.*, **/secrets/**"
            />
            <span className="agents-field-hint">{t('settings.agentsSection.fieldPathDenyHint')}</span>
          </label>

          <div className="agents-field-row">
            <label className="agents-field">
              <span>{t('settings.agentsSection.fieldMaxEdits')}</span>
              <input
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
              <span>{t('settings.agentsSection.fieldMaxShell')}</span>
              <input
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
              <span>{t('settings.agentsSection.fieldMaxToolCalls')}</span>
              <input
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
            <span>{t('settings.agentsSection.fieldTools')}</span>
            <textarea
              value={toolsText}
              onChange={(e) => setToolsText(e.target.value)}
              rows={2}
              placeholder="read_file, grep_search, repo_map"
            />
            <span className="agents-field-hint">{t('settings.agentsSection.fieldToolsHint')}</span>
          </label>

          <label className="agents-field">
            <span>{t('settings.agentsSection.fieldDeny')}</span>
            <textarea
              value={denyText}
              onChange={(e) => setDenyText(e.target.value)}
              rows={2}
              placeholder="spawn_agent, shell_exec"
            />
          </label>

          {editorMode === 'create' && (
            <label className="agents-field">
              <span>{t('settings.agentsSection.fieldScope')}</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'project' | 'user')}
              >
                <option value="project" disabled={!projectPath}>
                  {t('settings.agentsSection.scopeProject')}
                  {!projectPath ? ` (${t('settings.agentsSection.scopeNoProject')})` : ''}
                </option>
                <option value="user">{t('settings.agentsSection.scopeUser')}</option>
              </select>
            </label>
          )}

          {existingPath && (
            <div className="agents-settings-meta">
              {t('settings.agentsSection.path')}: {existingPath}
            </div>
          )}

          <div className="agents-editor-actions">
            <button
              type="button"
              className="agents-settings-primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? t('settings.agentsSection.saving') : t('settings.agentsSection.save')}
            </button>
            <button type="button" className="agents-settings-refresh" onClick={closeEditor}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <h4 className="agents-settings-h">
        {t('settings.agentsSection.builtin')} ({builtins.length})
      </h4>
      <ul className="agents-settings-list agents-grid">
        {builtins.map((p) => renderCard(p, false))}
      </ul>

      <h4 className="agents-settings-h">
        {t('settings.agentsSection.custom')} ({custom.length})
      </h4>
      {custom.length === 0 ? (
        <div className="agents-settings-muted">{t('settings.agentsSection.customEmpty')}</div>
      ) : (
        <ul className="agents-settings-list agents-grid">
          {custom.map((p) => renderCard(p, true))}
        </ul>
      )}
    </div>
  )
}
