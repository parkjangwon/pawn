import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useRoutineStore } from '../stores/routine'
import { useMcpStore } from '../stores/mcp'
import { usePrefsStore } from '../stores/prefs'
import { useAppStore } from '../stores/app'
import {
  KEYBINDING_IDS, DEFAULT_KEYBINDINGS, comboToString, formatCombo,
  useKeybindingsStore, type KeyBindingId
} from '../stores/keybindings'
import { guessPricing, type ApiFormat, type ModelPricing, type Provider } from '../types/provider'
import { PROVIDER_PRESETS, type ProviderPreset } from '../agent/providerPresets'
import { loadProjectContext, skillSummary, type LoadedSkill } from '../agent/skills'
import { isSkillEnabled, loadDisabledSkillNames, setSkillEnabled } from '../utils/skillVisibility'
import { useSidebarResize } from '../hooks/useSidebarResize'
import ConfirmDialog from './ConfirmDialog'
import NavControls from './NavControls'
import './Settings.css'

type SettingsSection = 'appearance' | 'providers' | 'models' | 'agent' | 'plugins' | 'mcp' | 'routines' | 'system' | 'shortcuts' | 'data'
type SettingsSkillScope = 'all' | 'project' | 'device' | 'builtin'
type SourceSignalId =
  | 'project-claude'
  | 'project-rules'
  | 'project-plugins'
  | 'user-claude'
  | 'user-skills'
  | 'user-agents'
  | 'user-agents-skills'
type SettingsDeleteTarget =
  | { type: 'provider'; id: string; name: string }
  | { type: 'model'; id: string; name: string }
  | { type: 'routine'; id: string; name: string }

interface SourceSignal {
  id: SourceSignalId
  path: string
  detected: boolean
  details?: string
}

interface SettingsProps {
  onSidebarWidthChange: (width: number) => void
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
}

const SECTIONS: { id: SettingsSection; labelKey: string; groupKey: string; icon: string }[] = [
  { id: 'appearance', labelKey: 'settings.appearance', groupKey: 'settings.groups.general', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'providers', labelKey: 'settings.providers', groupKey: 'settings.groups.general', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
  { id: 'models', labelKey: 'settings.models', groupKey: 'settings.groups.general', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'agent', labelKey: 'settings.agent', groupKey: 'settings.groups.coding', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'plugins', labelKey: 'settings.plugins', groupKey: 'settings.groups.integration', icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
  { id: 'mcp', labelKey: 'settings.mcp', groupKey: 'settings.groups.integration', icon: 'M20 7H4a2 2 0 00-2 2v1a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM6 11h.01M20 15H4a2 2 0 00-2 2v1a2 2 0 002 2h16a2 2 0 002-2v-1a2 2 0 00-2-2zM6 19h.01' },
  { id: 'system', labelKey: 'settings.system', groupKey: 'settings.groups.system', icon: 'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z' },
  { id: 'shortcuts', labelKey: 'settings.shortcuts', groupKey: 'settings.groups.system', icon: 'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM7 8h10M7 12h4' },
  { id: 'data', labelKey: 'settings.data', groupKey: 'settings.groups.general', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' },
]

export default function Settings({
  onSidebarWidthChange, canGoBack, canGoForward, onGoBack, onGoForward
}: SettingsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { theme, set } = useThemeStore()
  const { routines, runningIds, add: addRoutine, toggle: toggleRoutine, remove: removeRoutine, runNow } = useRoutineStore()
  const { servers: mcpServers, toggleServer: toggleMcpServer } = useMcpStore()
  const { sleepPrevention, setSleepPrevention, taskNotificationsEnabled, setTaskNotificationsEnabled } = usePrefsStore()
  const { bindings: keybindings, setBinding: setKeybinding, reset: resetKeybinding } = useKeybindingsStore()
  const [recording, setRecording] = useState<KeyBindingId | null>(null)
  const [trayVisible, setTrayVisible] = useState(true)
  const [navOpen, setNavOpen] = useState(true)

  // Same drag-to-resize behavior (and width) as the main sidebar.
  const attachResizer = useSidebarResize(onSidebarWidthChange)

  // App.tsx's toggle-sidebar shortcut routes here while Settings is open,
  // since the main sidebar it would otherwise toggle is hidden behind this
  // full-screen overlay.
  useEffect(() => {
    (window as any).__toggleSettingsNav = () => setNavOpen((v) => !v)
    return () => { delete (window as any).__toggleSettingsNav }
  }, [])

  const {
    providers, models, routingMode, defaultSendMode, permissionMode,
    addProvider, removeProvider, updateProvider,
    addModel, removeModel, setRoutingMode, setDefaultSendMode, setPermissionMode
  } = useProviderStore()

  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [presetPicking, setPresetPicking] = useState<ProviderPreset | null>(null)
  const [presetKey, setPresetKey] = useState('')
  const [showAddModel, setShowAddModel] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    name: '',
    apiFormat: 'openai' as ApiFormat,
    baseUrl: '',
    apiKey: ''
  })
  const [modelForm, setModelForm] = useState({
    providerId: '', modelId: '', label: '', tier: 'mid' as 'low' | 'mid' | 'high',
    input: '', output: '', cacheRead: '', cacheWrite: '', contextWindow: ''
  })
  const [routineForm, setRoutineForm] = useState({
    name: '', prompt: '', type: 'interval' as 'interval' | 'daily' | 'weekly',
    minutes: 30, time: '09:00', weekday: 1
  })
  const [homeDir, setHomeDir] = useState<string>('')
  const [loadedSkills, setLoadedSkills] = useState<LoadedSkill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillScope, setSkillScope] = useState<SettingsSkillScope>('all')
  const [skillSearch, setSkillSearch] = useState('')
  const [disabledSkills, setDisabledSkills] = useState<Set<string>>(new Set())
  const [contextSignals, setContextSignals] = useState<SourceSignal[]>([])
  const [contextAdditionCount, setContextAdditionCount] = useState(0)
  const [mcpLoading, setMcpLoading] = useState(false)
  const [showAddMcpServer, setShowAddMcpServer] = useState(false)
  const [mcpForm, setMcpForm] = useState({ id: '', command: '', args: '', env: '' })
  const [mcpScope, setMcpScope] = useState<'user' | 'project'>('project')
  const [mcpFormError, setMcpFormError] = useState<string | null>(null)
  const [mcpAdding, setMcpAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SettingsDeleteTarget | null>(null)
  const [pawnPaths, setPawnPaths] = useState<{ configPath: string; dataDir: string } | null>(null)
  const { projects, activeProjectId } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectPath = activeProject?.paths?.[0] || ''

  const applyModelIdGuess = (modelId: string): void => {
    const guess = guessPricing(modelId)
    setModelForm((f) => ({
      ...f,
      modelId,
      tier: guess?.tier || f.tier,
      input: guess ? String(guess.input) : f.input,
      output: guess ? String(guess.output) : f.output,
      cacheRead: guess ? String(guess.cacheRead) : f.cacheRead,
      cacheWrite: guess ? String(guess.cacheWrite) : f.cacheWrite,
      contextWindow: guess ? String(guess.contextWindow) : f.contextWindow
    }))
  }

  const handleAddFromPreset = (preset: ProviderPreset, apiKey: string): void => {
    if (!preset.localNoKey && !apiKey.trim()) return
    const before = useProviderStore.getState().providers.length
    addProvider({
      id: '',
      name: preset.name,
      apiFormat: preset.apiFormat,
      baseUrl: preset.baseUrl,
      apiKey: apiKey.trim() || undefined,
      enabled: true
    })
    const after = useProviderStore.getState().providers
    const created: Provider | undefined = after.length > before ? after[after.length - 1] : undefined
    if (created) {
      for (const m of preset.models) {
        const guess = guessPricing(m.modelId)
        useProviderStore.getState().addModel({
          id: '', providerId: created.id, modelId: m.modelId, label: m.label, tier: m.tier, enabled: true,
          pricing: guess ? { input: guess.input, output: guess.output, cacheRead: guess.cacheRead, cacheWrite: guess.cacheWrite } : undefined,
          contextWindow: guess?.contextWindow
        })
      }
    }
    setPresetPicking(null)
    setPresetKey('')
  }

  const handleAddProvider = (): void => {
    if (!form.name.trim() || !form.baseUrl.trim()) return
    addProvider({
      id: '',
      name: form.name.trim(),
      apiFormat: form.apiFormat,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      enabled: true
    })
    setForm({
      name: '',
      apiFormat: 'openai',
      baseUrl: '',
      apiKey: ''
    })
    setShowAddProvider(false)
  }

  const handleAddModel = (): void => {
    if (!modelForm.providerId || !modelForm.modelId.trim()) return
    const num = (s: string): number | undefined => (s.trim() ? Number(s) : undefined)
    const input = num(modelForm.input)
    const output = num(modelForm.output)
    const cacheRead = num(modelForm.cacheRead)
    const cacheWrite = num(modelForm.cacheWrite)
    const pricing: ModelPricing | undefined =
      input !== undefined && output !== undefined
        ? { input, output, cacheRead: cacheRead ?? input * 0.1, cacheWrite: cacheWrite ?? input * 1.25 }
        : undefined
    addModel({
      id: '',
      providerId: modelForm.providerId,
      modelId: modelForm.modelId.trim(),
      label: modelForm.label.trim() || modelForm.modelId.trim(),
      tier: modelForm.tier,
      enabled: true,
      pricing,
      contextWindow: num(modelForm.contextWindow)
    })
    setModelForm({ providerId: '', modelId: '', label: '', tier: 'mid', input: '', output: '', cacheRead: '', cacheWrite: '', contextWindow: '' })
    setShowAddModel(false)
  }

  const handleAddMcpServer = async (): Promise<void> => {
    if (!mcpForm.id.trim() || !mcpForm.command.trim() || mcpAdding) return
    setMcpAdding(true)
    setMcpFormError(null)
    const args = mcpForm.args.trim() ? mcpForm.args.trim().split(/\s+/) : []
    const envEntries = mcpForm.env.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): [string, string] => {
        const idx = line.indexOf('=')
        return idx === -1 ? [line, ''] : [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
      })
      .filter(([key]) => key)
    const env = envEntries.length ? Object.fromEntries(envEntries) : undefined

    const res = await useMcpStore.getState().addServer(
      mcpScope,
      mcpScope === 'project' ? (projectPath || undefined) : undefined,
      mcpForm.id.trim(),
      { command: mcpForm.command.trim(), args, env }
    )
    setMcpAdding(false)
    if (res.ok) {
      setMcpForm({ id: '', command: '', args: '', env: '' })
      setShowAddMcpServer(false)
    } else {
      setMcpFormError(res.error || t('settings.mcpSection.addFailed'))
    }
  }

  const handleRemoveMcpServer = async (server: { id: string; source: McpServerSource }): Promise<void> => {
    const scope = server.source === 'user-pawn' ? 'user' : 'project'
    await useMcpStore.getState().removeServer(scope, scope === 'project' ? (projectPath || undefined) : undefined, server.id)
  }

  const handleTestProvider = async (providerId: string): Promise<void> => {
    const p = providers.find((pr) => pr.id === providerId)
    if (!p) return
    setTestingId(providerId)
    setTestResult((r) => ({ ...r, [providerId]: '' }))
    try {
      const url = p.apiFormat === 'claude' ? `${p.baseUrl}/messages` : `${p.baseUrl}/chat/completions`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = p.apiKey || ''
      if (p.apiFormat === 'claude') { headers['x-api-key'] = token; headers['anthropic-version'] = '2023-06-01' }
      else { headers['Authorization'] = `Bearer ${token}` }
      const body = p.apiFormat === 'claude' ? { model: 'claude-3-haiku-20240307', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] } : { model: 'gpt-4o-mini', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }
      const isBrowser = window.api?.platform === 'browser'
      let response: Response
      if (isBrowser) { response = await fetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, headers, body: JSON.stringify(body) }) }) }
      else { response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }) }
      if (response.ok) setTestResult((r) => ({ ...r, [providerId]: 'OK' }))
      else { setTestResult((r) => ({ ...r, [providerId]: `FAIL: ${response.status}` })) }
    } catch { setTestResult((r) => ({ ...r, [providerId]: 'ERROR' })) }
    finally { setTestingId(null) }
  }

  const languages = [{ code: 'en', label: 'English' }, { code: 'ko', label: '한국어' }, { code: 'ja', label: '日本語' }, { code: 'zh', label: '中文' }]

  const handleAddRoutine = async (): Promise<void> => {
    if (!routineForm.name.trim() || !routineForm.prompt.trim()) return
    const [hour, minute] = routineForm.time.split(':').map(Number)
    const schedule: RoutineSchedule = routineForm.type === 'interval'
      ? { type: 'interval', minutes: Math.max(1, Number(routineForm.minutes) || 30) }
      : routineForm.type === 'daily'
        ? { type: 'daily', hour, minute }
        : { type: 'weekly', weekday: routineForm.weekday, hour, minute }
    await addRoutine({ name: routineForm.name, prompt: routineForm.prompt, schedule })
    setRoutineForm({ name: '', prompt: '', type: 'interval', minutes: 30, time: '09:00', weekday: 1 })
  }

  const routineScheduleLabel = (scheduleJson: string): string => {
    try {
      const s = JSON.parse(scheduleJson) as RoutineSchedule
      if (s.type === 'interval') return t('settings.routineSection.everyMinutes', { minutes: s.minutes })
      const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
      if (s.type === 'daily') return t('settings.routineSection.dailyAt', { time })
      return t('settings.routineSection.weeklyAt', { weekday: t(`settings.routineSection.weekdays.${s.weekday}`), time })
    } catch {
      return ''
    }
  }

  const formatRunTime = (ms: number): string => {
    if (!ms) return t('settings.routineSection.never')
    return new Date(ms).toLocaleString(i18n.language)
  }

  // Capture the next key combination while a shortcut row is recording.
  useEffect(() => {
    if (!recording) return
    // Stop main-process forwarding so the pressed keys reach the recorder.
    void window.api.keybindings?.setPaused?.(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
      setKeybinding(recording, comboToString({ alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, key: e.key }))
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void window.api.keybindings?.setPaused?.(false)
    }
  }, [recording, setKeybinding])

  const shortcutLabel = (id: KeyBindingId): string => t(`settings.shortcutSection.${id}`)
  const comboConflict = (id: KeyBindingId): KeyBindingId | null => {
    const combo = keybindings[id]
    return KEYBINDING_IDS.find(
      (other) => other !== id && keybindings[other] === combo && combo !== DEFAULT_KEYBINDINGS[id]
    ) || null
  }

  useEffect(() => {
    window.api.fs.homeDir().then((home) => {
      if (typeof home === 'string') setHomeDir(home)
    }).catch(() => {})
    window.api.config.getPaths().then((paths) => setPawnPaths(paths)).catch(() => {})
    setDisabledSkills(loadDisabledSkillNames())
    void window.api.tray?.getEnabled().then((v) => setTrayVisible(v === true)).catch(() => {})
  }, [])

  const fileExists = async (path: string): Promise<boolean> => {
    const r = await window.api.fs.readFile(path)
    return typeof r === 'string'
  }

  const countMarkdownFiles = async (path: string): Promise<number> => {
    const entries = await window.api.fs.listDir(path)
    if (!Array.isArray(entries)) return 0
    return entries.filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.md')).length
  }

  const countSubdirs = async (path: string): Promise<number> => {
    const entries = await window.api.fs.listDir(path)
    if (!Array.isArray(entries)) return 0
    return entries.filter((e) => e.isDirectory).length
  }

  const detectContextSignals = async (): Promise<SourceSignal[]> => {
    const root = projectPath ? (projectPath.endsWith('/') ? projectPath : `${projectPath}/`) : ''
    const userRoot = homeDir ? `${homeDir}/.claude/` : ''
    const rows: SourceSignal[] = []

    if (root) {
      const claudePath = `${root}CLAUDE.md`
      const rulesPath = `${root}.claude/rules`
      const pluginsPath = `${root}.claude/plugins`
      const [hasClaude, rulesCount, pluginsCount] = await Promise.all([
        fileExists(claudePath),
        countMarkdownFiles(rulesPath),
        countSubdirs(pluginsPath)
      ])
      rows.push({ id: 'project-claude', path: claudePath, detected: hasClaude })
      rows.push({ id: 'project-rules', path: rulesPath, detected: rulesCount > 0, details: rulesCount > 0 ? `${rulesCount}` : undefined })
      rows.push({ id: 'project-plugins', path: pluginsPath, detected: pluginsCount > 0, details: pluginsCount > 0 ? `${pluginsCount}` : undefined })
    } else {
      rows.push({ id: 'project-claude', path: '', detected: false })
      rows.push({ id: 'project-rules', path: '', detected: false })
      rows.push({ id: 'project-plugins', path: '', detected: false })
    }

    if (userRoot) {
      const userClaudePath = `${userRoot}CLAUDE.md`
      const userSkillsPath = `${userRoot}skills`
      const [hasUserClaude, userSkillCount] = await Promise.all([
        fileExists(userClaudePath),
        countSubdirs(userSkillsPath)
      ])
      rows.push({ id: 'user-claude', path: userClaudePath, detected: hasUserClaude })
      rows.push({ id: 'user-skills', path: userSkillsPath, detected: userSkillCount > 0, details: userSkillCount > 0 ? `${userSkillCount}` : undefined })

      const userAgentsMdPath = `${homeDir}/.agents/AGENTS.md`
      const userAgentsSkillsPath = `${homeDir}/.agents/skills`
      const [hasUserAgentsMd, userAgentsSkillCount] = await Promise.all([
        fileExists(userAgentsMdPath),
        countSubdirs(userAgentsSkillsPath)
      ])
      rows.push({ id: 'user-agents', path: userAgentsMdPath, detected: hasUserAgentsMd })
      rows.push({ id: 'user-agents-skills', path: userAgentsSkillsPath, detected: userAgentsSkillCount > 0, details: userAgentsSkillCount > 0 ? `${userAgentsSkillCount}` : undefined })
    } else {
      rows.push({ id: 'user-claude', path: '', detected: false })
      rows.push({ id: 'user-skills', path: '', detected: false })
      rows.push({ id: 'user-agents', path: '', detected: false })
      rows.push({ id: 'user-agents-skills', path: '', detected: false })
    }
    return rows
  }

  useEffect(() => {
    if (activeSection !== 'plugins') return
    setSkillsLoading(true)
    Promise.all([
      loadProjectContext(projectPath || undefined),
      detectContextSignals()
    ])
      .then(([ctx, signals]) => {
        setLoadedSkills(ctx.skills)
        setContextAdditionCount(ctx.systemAdditions.length)
        setContextSignals(signals)
      })
      .catch(() => {
        setLoadedSkills([])
        setContextAdditionCount(0)
        setContextSignals([])
      })
      .finally(() => setSkillsLoading(false))
  }, [activeSection, projectPath, homeDir])

  // MCP server status is only worth fetching (and connecting to servers for)
  // while the panel showing it is actually open.
  useEffect(() => {
    if (activeSection !== 'mcp') return
    setMcpLoading(true)
    useMcpStore.getState().refresh(projectPath || undefined).finally(() => setMcpLoading(false))
  }, [activeSection, projectPath])

  const groups = useMemo(() => [...new Set(SECTIONS.map((s) => s.groupKey))], [])

  const visibleSkills = useMemo(() => {
    const base = loadedSkills.filter((skill) => {
      if (skillScope === 'all') return true
      if (skillScope === 'project') {
        const normalized = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
        return Boolean(projectPath) && skill.source.startsWith(normalized)
      }
      if (skillScope === 'device') {
        const normalized = homeDir.endsWith('/') ? homeDir : `${homeDir}/`
        return Boolean(homeDir) && skill.source.startsWith(normalized)
      }
      const normalizedProject = projectPath ? (projectPath.endsWith('/') ? projectPath : `${projectPath}/`) : ''
      const normalizedHome = homeDir ? (homeDir.endsWith('/') ? homeDir : `${homeDir}/`) : ''
      const inProject = normalizedProject ? skill.source.startsWith(normalizedProject) : false
      const inHome = normalizedHome ? skill.source.startsWith(normalizedHome) : false
      return !inProject && !inHome
    })
    const query = skillSearch.trim().toLowerCase()
    if (!query) return base
    return base.filter((skill) => {
      const summary = skillSummary(skill).toLowerCase()
      return skill.name.toLowerCase().includes(query)
        || skill.kind.toLowerCase().includes(query)
        || skill.source.toLowerCase().includes(query)
        || summary.includes(query)
    })
  }, [loadedSkills, skillScope, skillSearch, projectPath, homeDir])

  const scopeCounts = useMemo(() => {
    const normalizedProject = projectPath ? (projectPath.endsWith('/') ? projectPath : `${projectPath}/`) : ''
    const normalizedHome = homeDir ? (homeDir.endsWith('/') ? homeDir : `${homeDir}/`) : ''
    const all = loadedSkills.length
    const project = loadedSkills.filter((s) => normalizedProject && s.source.startsWith(normalizedProject)).length
    const device = loadedSkills.filter((s) => normalizedHome && s.source.startsWith(normalizedHome)).length
    const builtin = Math.max(0, all - project - device)
    return { all, project, device, builtin }
  }, [loadedSkills, projectPath, homeDir])

  const enabledSkillCount = useMemo(
    () => loadedSkills.filter((s) => isSkillEnabled(s.name, disabledSkills)).length,
    [loadedSkills, disabledSkills]
  )

  const toggleSkill = (skillName: string): void => {
    const nextEnabled = !isSkillEnabled(skillName, disabledSkills)
    setDisabledSkills(setSkillEnabled(skillName, nextEnabled))
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!confirmDelete) return
    if (confirmDelete.type === 'provider') {
      removeProvider(confirmDelete.id)
    } else if (confirmDelete.type === 'model') {
      removeModel(confirmDelete.id)
    } else {
      await removeRoutine(confirmDelete.id)
    }
    setConfirmDelete(null)
  }

  return (
    <div className={`settings-page ${navOpen ? '' : 'nav-collapsed'}`}>
      <div className="settings-header">
        <div className="settings-header-left">
          <button className="settings-header-back" onClick={() => setNavOpen((v) => !v)} aria-label={t('settings.toggleNav')} title={t('settings.toggleNav')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <NavControls canGoBack={canGoBack} canGoForward={canGoForward} onBack={onGoBack} onForward={onGoForward} />
        </div>
      </div>
      <div className="settings-sidebar">
        <div className="settings-sidebar-top-row">
          <span className="sidebar-logo">Pawn</span>
        </div>
        <div className="settings-nav">
          {groups.map((group) => (
            <div key={group} className="settings-nav-group">
              <div className="settings-nav-label">{t(group)}</div>
              {SECTIONS.filter((s) => s.groupKey === group).map((section) => (
                <button key={section.id} className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`} onClick={() => setActiveSection(section.id)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={section.icon} /></svg>
                  <span>{t(section.labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-resizer" ref={attachResizer} role="separator" aria-orientation="vertical" />

      <div className="settings-content">
        {activeSection === 'appearance' && (
          <div className="settings-section">
            <h2>{t('settings.appearanceSection.title')}</h2>
            <p className="settings-desc">{t('settings.appearanceSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.appearanceSection.theme')}</span><span className="settings-row-desc">{t('settings.appearanceSection.themeDesc')}</span></div>
                <div className="theme-toggle"><button className={theme === 'light' ? 'active' : ''} onClick={() => set('light')}>{t('theme.light')}</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => set('dark')}>{t('theme.dark')}</button><button className={theme === 'system' ? 'active' : ''} onClick={() => set('system')}>{t('theme.system')}</button></div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.appearanceSection.language')}</span><span className="settings-row-desc">{t('settings.appearanceSection.languageDesc')}</span></div>
                <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'providers' && (
          <div className="settings-section">
            <h2>{t('settings.providerSection.title')}</h2>
            <p className="settings-desc">{t('settings.providerSection.desc')}</p>
            <div className="settings-card">
              {providers.map((p) => (
                <div key={p.id} className="settings-row provider-row">
                  <div className="settings-row-info">
                    <span className="settings-row-label">{p.name}</span>
                    <span className="settings-row-desc">
                      {p.apiFormat} / {p.baseUrl}
                    </span>
                  </div>
                  <div className="settings-row-actions">
                    <button className={`test-btn ${testResult[p.id] === 'OK' ? 'ok' : testResult[p.id]?.startsWith('FAIL') ? 'fail' : ''}`} onClick={() => handleTestProvider(p.id)} disabled={testingId === p.id}>{testingId === p.id ? '...' : testResult[p.id] || 'Test'}</button>
                    <label className="toggle-switch"><input type="checkbox" checked={p.enabled} onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })} /><span className="toggle-slider" /></label>
                    <button className="delete-btn" onClick={() => setConfirmDelete({ type: 'provider', id: p.id, name: p.name })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                  </div>
                </div>
              ))}
              {providers.length === 0 && <div className="settings-empty">{t('settings.providerSection.empty')}</div>}
            </div>

            <div className="preset-section">
              <div className="settings-row-desc preset-section-label">{t('settings.providerSection.presetDesc')}</div>
              <div className="preset-grid">
                {PROVIDER_PRESETS.map((preset) => {
                  const isAlreadyAdded = providers.some(
                    (p) => p.name.toLowerCase() === preset.name.toLowerCase()
                  )
                  return (
                    <button 
                      key={preset.id} 
                      className={`preset-chip ${isAlreadyAdded ? 'disabled' : ''}`} 
                      onClick={() => { setPresetPicking(preset); setPresetKey('') }}
                      disabled={isAlreadyAdded}
                      style={isAlreadyAdded ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                    >
                      {preset.name}
                    </button>
                  )
                })}
              </div>
              {presetPicking && (
                <div className="settings-card add-form preset-form">
                  <div className="settings-row-label">{presetPicking.name}</div>
                  <div className="settings-row-desc">{presetPicking.baseUrl}</div>
                  <div className="settings-row-desc">
                    {presetPicking.keyHintKey ? t(presetPicking.keyHintKey) : presetPicking.keyHint}
                  </div>
                  {!presetPicking.localNoKey && (
                    <input
                      type="password"
                      placeholder={t('settings.providerSection.pasteApiKey')}
                      value={presetKey}
                      onChange={(e) => setPresetKey(e.target.value)}
                      autoFocus
                    />
                  )}
                  <div className="form-actions">
                    <button
                      className="btn-primary"
                      onClick={() => handleAddFromPreset(presetPicking, presetKey)}
                      disabled={!presetPicking.localNoKey && !presetKey.trim()}
                    >
                      {t('settings.providerSection.addWithModels', { count: presetPicking.models.length })}
                    </button>
                    <button className="btn-cancel" onClick={() => setPresetPicking(null)}>{t('common.cancel')}</button>
                  </div>
                </div>
              )}
            </div>

            {showAddProvider ? (
              <div className="settings-card add-form" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input placeholder={t('settings.providerSection.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <select value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as ApiFormat })}><option value="openai">{t('settings.providerSection.openai')}</option><option value="claude">{t('settings.providerSection.claude')}</option></select>
                <input placeholder={t('settings.providerSection.baseUrlPlaceholder')} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
                <input type="password" placeholder={t('settings.providerSection.apiKeyPlaceholder')} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
                <div className="form-actions">
                  <button className="btn-primary" onClick={handleAddProvider}>{t('common.save')}</button>
                  <button className="btn-cancel" onClick={() => setShowAddProvider(false)}>{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddProvider(true)}>{t('settings.providerSection.add')}</button>
            )}
          </div>
        )}

        {activeSection === 'models' && (
          <div className="settings-section">
            <h2>{t('settings.modelSection.title')}</h2>
            <p className="settings-desc">{t('settings.modelSection.desc')}</p>
            <div className="settings-card">
              {models.map((m) => (
                <div key={m.id} className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-label">{m.label || m.modelId}</span>
                    <span className="settings-row-desc">
                      {providers.find((p) => p.id === m.providerId)?.name} / {m.tier}
                      {m.pricing
                        ? t('settings.modelSection.pricingFormat', { input: m.pricing.input, output: m.pricing.output })
                        : t('settings.modelSection.pricingUnknown')}
                    </span>
                  </div>
                  <button className="delete-btn" onClick={() => setConfirmDelete({ type: 'model', id: m.id, name: m.label || m.modelId })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                </div>
              ))}
              {models.length === 0 && <div className="settings-empty">{t('settings.modelSection.empty')}</div>}
            </div>
            {showAddModel ? (
              <div className="settings-card add-form">
                <select value={modelForm.providerId} onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}><option value="">{t('settings.modelSection.selectProvider')}</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input placeholder={t('settings.modelSection.modelIdPlaceholder')} value={modelForm.modelId} onChange={(e) => applyModelIdGuess(e.target.value)} />
                <input placeholder={t('settings.modelSection.displayNamePlaceholder')} value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
                <select value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}><option value="low">{t('settings.modelSection.tierLow')}</option><option value="mid">{t('settings.modelSection.tierMid')}</option><option value="high">{t('settings.modelSection.tierHigh')}</option></select>
                <div className="settings-row-desc" style={{ marginTop: 4 }}>{t('settings.modelSection.pricingDesc')}</div>
                <div className="pricing-grid">
                  <input placeholder={t('settings.modelSection.priceInput')} type="number" step="0.01" value={modelForm.input} onChange={(e) => setModelForm({ ...modelForm, input: e.target.value })} />
                  <input placeholder={t('settings.modelSection.priceOutput')} type="number" step="0.01" value={modelForm.output} onChange={(e) => setModelForm({ ...modelForm, output: e.target.value })} />
                  <input placeholder={t('settings.modelSection.priceCacheRead')} type="number" step="0.01" value={modelForm.cacheRead} onChange={(e) => setModelForm({ ...modelForm, cacheRead: e.target.value })} />
                  <input placeholder={t('settings.modelSection.priceCacheWrite')} type="number" step="0.01" value={modelForm.cacheWrite} onChange={(e) => setModelForm({ ...modelForm, cacheWrite: e.target.value })} />
                </div>
                <input placeholder={t('settings.modelSection.contextWindow')} type="number" value={modelForm.contextWindow} onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value })} />
                <div className="form-actions"><button className="btn-primary" onClick={handleAddModel}>{t('common.save')}</button><button className="btn-cancel" onClick={() => setShowAddModel(false)}>{t('common.cancel')}</button></div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddModel(true)}>{t('settings.modelSection.add')}</button>
            )}
          </div>
        )}

        {activeSection === 'agent' && (
          <div className="settings-section">
            <h2>{t('settings.agentSection.title')}</h2>
            <p className="settings-desc">{t('settings.agentSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.agentSection.routing')}</span><span className="settings-row-desc">{t('settings.agentSection.routingDesc')}</span></div>
                <div className="theme-toggle"><button className={routingMode === 'auto' ? 'active' : ''} onClick={() => setRoutingMode('auto')}>{t('statusBar.auto')}</button><button className={routingMode === 'manual' ? 'active' : ''} onClick={() => setRoutingMode('manual')}>{t('statusBar.manual')}</button></div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.agentSection.sendMode')}</span><span className="settings-row-desc">{t('settings.agentSection.sendModeDesc')}</span></div>
                <select value={defaultSendMode} onChange={(e) => setDefaultSendMode(e.target.value as 'queue' | 'steer')}><option value="queue">{t('settings.agentSection.queue')}</option><option value="steer">{t('settings.agentSection.steer')}</option></select>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.agentSection.permissionMode')}</span><span className="settings-row-desc">{t('settings.agentSection.permissionModeDesc')}</span></div>
                <div className="theme-toggle">
                  <button className={permissionMode === 'ask' ? 'active' : ''} onClick={() => setPermissionMode('ask')}>{t('permission.ask')}</button>
                  <button className={permissionMode === 'auto' ? 'active' : ''} onClick={() => setPermissionMode('auto')}>{t('permission.auto')}</button>
                  <button className={permissionMode === 'yolo' ? 'active' : ''} onClick={() => setPermissionMode('yolo')}>{t('permission.yolo')}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'plugins' && (
          <div className="settings-section">
            <h2>{t('settings.pluginSection.title')}</h2>
            <p className="settings-desc">{t('settings.pluginSection.desc')}</p>
            <div className="settings-card">
              <div className="plugin-context-head">
                <span className="settings-row-label">{t('settings.pluginSection.contextTitle')}</span>
                <span className="settings-row-desc">
                  {t('settings.pluginSection.contextApplied', {
                    blocks: contextAdditionCount,
                    enabled: enabledSkillCount,
                    total: loadedSkills.length
                  })}
                </span>
              </div>
              <div className="plugin-context-list">
                {contextSignals.map((signal) => (
                  <div key={signal.id} className="plugin-context-item">
                    <div className="plugin-context-main">
                      <span className="plugin-context-label">{t(`settings.pluginSection.sources.${signal.id}`)}</span>
                      <span className="plugin-context-path">{signal.path || t('settings.pluginSection.noProjectPath')}</span>
                    </div>
                    <span className={`plugin-context-status ${signal.detected ? 'ok' : 'off'}`}>
                      {signal.detected ? t('settings.pluginSection.detected') : t('settings.pluginSection.missing')}
                      {signal.details ? ` (${signal.details})` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="plugin-toolbar">
                <div className="plugin-scope-toggle" role="tablist" aria-label={t('settings.pluginSection.scopeLabel')}>
                  {(['all', 'project', 'device', 'builtin'] as SettingsSkillScope[]).map((scope) => (
                    <button
                      key={scope}
                      role="tab"
                      aria-selected={skillScope === scope}
                      className={`plugin-scope-btn ${skillScope === scope ? 'active' : ''}`}
                      onClick={() => setSkillScope(scope)}
                    >
                      {t(`settings.pluginSection.scope.${scope}`)} ({scopeCounts[scope]})
                    </button>
                  ))}
                </div>
                <input
                  className="plugin-search-input"
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder={t('settings.pluginSection.searchPlaceholder')}
                />
              </div>
              {skillsLoading && <div className="settings-empty">{t('common.loading')}</div>}
              {!skillsLoading && visibleSkills.length === 0 && <div className="settings-empty">{t('settings.pluginSection.emptySkills')}</div>}
              {!skillsLoading && visibleSkills.map((skill) => {
                const enabled = isSkillEnabled(skill.name, disabledSkills)
                return (
                  <div key={`${skill.kind}:${skill.source}`} className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-row-label">
                        {skill.name}
                        <span className="plugin-kind">{t(`settings.pluginSection.kind.${skill.kind}`)}</span>
                      </span>
                      <span className="settings-row-desc">{skillSummary(skill) || skill.source}</span>
                      <span className="plugin-source">{skill.source}</span>
                    </div>
                    <div className="settings-row-actions">
                      <label className="toggle-switch">
                        <input type="checkbox" checked={enabled} onChange={() => toggleSkill(skill.name)} />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeSection === 'mcp' && (
          <div className="settings-section">
            <h2>{t('settings.mcpSection.title')}</h2>
            <p className="settings-desc">{t('settings.mcpSection.desc')}</p>
            <div className="settings-card">
              {mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{t('common.loading')}</div>}
              {!mcpLoading && mcpServers.length === 0 && <div className="settings-empty">{t('settings.mcpSection.empty')}</div>}
              {mcpServers.map((server) => (
                <div key={server.id} className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-label">
                      {server.id}
                      <span className={`mcp-status-badge ${server.disabled ? 'disabled' : server.status}`}>
                        {server.disabled
                          ? t('settings.mcpSection.statusDisabled')
                          : server.status === 'connected'
                            ? t('settings.mcpSection.statusConnected', { count: server.toolCount })
                            : server.status === 'error'
                              ? t('settings.mcpSection.statusError')
                              : t('settings.mcpSection.statusConnecting')}
                      </span>
                    </span>
                    <span className="settings-row-desc">
                      {!server.disabled && server.status === 'error'
                        ? server.error
                        : t(`settings.mcpSection.source.${server.source}`)}
                    </span>
                  </div>
                  <div className="settings-row-actions">
                    <label className="toggle-switch">
                      <input type="checkbox" checked={!server.disabled} onChange={() => void toggleMcpServer(server.id)} />
                      <span className="toggle-slider" />
                    </label>
                    {server.source !== 'user-claude' && (
                      <button className="delete-btn" title={t('common.delete')} onClick={() => void handleRemoveMcpServer(server)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <p className="settings-mcp-hint">{t('settings.mcpSection.hint')}</p>
            </div>

            {showAddMcpServer ? (
              <div className="settings-card add-form">
                <div className="theme-toggle">
                  <button className={mcpScope === 'project' ? 'active' : ''} disabled={!projectPath} onClick={() => setMcpScope('project')}>{t('settings.mcpSection.scopeProject')}</button>
                  <button className={mcpScope === 'user' ? 'active' : ''} onClick={() => setMcpScope('user')}>{t('settings.mcpSection.scopeUser')}</button>
                </div>
                {mcpScope === 'project' && !projectPath && <div className="settings-row-desc">{t('settings.mcpSection.noProjectForScope')}</div>}
                <input placeholder={t('settings.mcpSection.idPlaceholder')} value={mcpForm.id} onChange={(e) => setMcpForm({ ...mcpForm, id: e.target.value })} />
                <input placeholder={t('settings.mcpSection.commandPlaceholder')} value={mcpForm.command} onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })} />
                <input placeholder={t('settings.mcpSection.argsPlaceholder')} value={mcpForm.args} onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })} />
                <textarea
                  className="mcp-env-input"
                  placeholder={t('settings.mcpSection.envPlaceholder')}
                  value={mcpForm.env}
                  onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
                  rows={3}
                />
                {mcpFormError && <div className="settings-row-desc mcp-form-error">{mcpFormError}</div>}
                <div className="form-actions">
                  <button className="btn-primary" onClick={() => void handleAddMcpServer()} disabled={mcpAdding || !mcpForm.id.trim() || !mcpForm.command.trim() || (mcpScope === 'project' && !projectPath)}>
                    {mcpAdding ? t('common.loading') : t('common.save')}
                  </button>
                  <button className="btn-cancel" onClick={() => { setShowAddMcpServer(false); setMcpFormError(null) }}>{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="add-btn-full" onClick={() => setShowAddMcpServer(true)}>{t('settings.mcpSection.add')}</button>
            )}
          </div>
        )}

        {activeSection === 'routines' && (
          <div className="settings-section">
            <h2>{t('settings.routineSection.title')}</h2>
            <p className="settings-desc">{t('settings.routineSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.routineSection.addTitle')}</span><span className="settings-row-desc">{t('settings.routineSection.addDesc')}</span></div>
              </div>
              <div className="add-form">
                <input placeholder={t('settings.routineSection.namePlaceholder')} value={routineForm.name} onChange={(e) => setRoutineForm((f) => ({ ...f, name: e.target.value }))} />
                <input placeholder={t('settings.routineSection.promptPlaceholder')} value={routineForm.prompt} onChange={(e) => setRoutineForm((f) => ({ ...f, prompt: e.target.value }))} />
                <select value={routineForm.type} onChange={(e) => setRoutineForm((f) => ({ ...f, type: e.target.value as 'interval' | 'daily' | 'weekly' }))}>
                  <option value="interval">{t('settings.routineSection.type.interval')}</option>
                  <option value="daily">{t('settings.routineSection.type.daily')}</option>
                  <option value="weekly">{t('settings.routineSection.type.weekly')}</option>
                </select>
                {routineForm.type === 'interval' && (
                  <input type="number" min={1} value={routineForm.minutes} onChange={(e) => setRoutineForm((f) => ({ ...f, minutes: Number(e.target.value) }))} />
                )}
                {routineForm.type !== 'interval' && (
                  <>
                    {routineForm.type === 'weekly' && (
                      <select value={routineForm.weekday} onChange={(e) => setRoutineForm((f) => ({ ...f, weekday: Number(e.target.value) }))}>
                        {[0, 1, 2, 3, 4, 5, 6].map((w) => (
                          <option key={w} value={w}>{t(`settings.routineSection.weekdays.${w}`)}</option>
                        ))}
                      </select>
                    )}
                    <input type="time" value={routineForm.time} onChange={(e) => setRoutineForm((f) => ({ ...f, time: e.target.value }))} />
                  </>
                )}
              </div>
              <div className="form-actions">
                <button className="btn-primary" disabled={!routineForm.name.trim() || !routineForm.prompt.trim()} onClick={() => void handleAddRoutine()}>{t('settings.routineSection.add')}</button>
              </div>
              <div className="settings-card">
                {routines.length === 0 && <div className="settings-empty">{t('settings.routineSection.empty')}</div>}
                {routines.map((r) => (
                  <div key={r.id} className="settings-row routine-row">
                    <div className="settings-row-info">
                      <span className="settings-row-label">{r.name}{runningIds.has(r.id) && <span className="settings-badge"> {t('settings.routineSection.running')}</span>}</span>
                      <span className="settings-row-desc">{routineScheduleLabel(r.schedule)} · {t('settings.routineSection.nextRun')} {formatRunTime(r.nextRunAt)} · {t('settings.routineSection.lastRun')} {formatRunTime(r.lastRunAt)}</span>
                      <span className="settings-row-desc">{r.prompt}</span>
                      {r.lastResult && <span className="settings-row-desc">{t('settings.routineSection.lastResult')} {r.lastResult.slice(0, 140)}</span>}
                    </div>
                    <div className="settings-row-actions">
                      <button className="test-btn" disabled={runningIds.has(r.id)} onClick={() => void runNow(r.id)}>{t('settings.routineSection.runNow')}</button>
                      <label className="toggle-switch"><input type="checkbox" checked={r.enabled} onChange={(e) => void toggleRoutine(r.id, e.target.checked)} /><span className="toggle-slider" /></label>
                      <button className="delete-btn" onClick={() => setConfirmDelete({ type: 'routine', id: r.id, name: r.name })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeSection === 'system' && (
          <div className="settings-section">
            <h2>{t('settings.systemSection.title')}</h2>
            <p className="settings-desc">{t('settings.systemSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.systemSection.sleepPrevention')}</span><span className="settings-row-desc">{t('settings.systemSection.sleepPreventionDesc')}</span></div>
                <div className="theme-toggle">
                  <button className={sleepPrevention === 'off' ? 'active' : ''} onClick={() => setSleepPrevention('off')}>{t('settings.systemSection.sleepOff')}</button>
                  <button className={sleepPrevention === 'sleep' ? 'active' : ''} onClick={() => setSleepPrevention('sleep')}>{t('settings.systemSection.sleepSystem')}</button>
                  <button className={sleepPrevention === 'display' ? 'active' : ''} onClick={() => setSleepPrevention('display')}>{t('settings.systemSection.sleepDisplay')}</button>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.systemSection.taskNotifications')}</span><span className="settings-row-desc">{t('settings.systemSection.taskNotificationsDesc')}</span></div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={taskNotificationsEnabled}
                    onChange={(e) => setTaskNotificationsEnabled(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.systemSection.trayEnabled')}</span><span className="settings-row-desc">{t('settings.systemSection.trayEnabledDesc')}</span></div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={trayVisible}
                    onChange={(e) => {
                      const next = e.target.checked
                      setTrayVisible(next)
                      void window.api.tray?.setEnabled(next).catch(() => {})
                    }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'shortcuts' && (
          <div className="settings-section">
            <h2>{t('settings.shortcutSection.title')}</h2>
            <p className="settings-desc">{t('settings.shortcutSection.desc')}</p>
            <div className="settings-card">
              {KEYBINDING_IDS.map((id) => {
                const conflict = comboConflict(id)
                return (
                  <div key={id} className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-row-label">{shortcutLabel(id)}</span>
                      <span className="settings-row-desc">
                        {recording === id
                          ? t('settings.shortcutSection.recording')
                          : conflict
                            ? t('settings.shortcutSection.conflict', { other: shortcutLabel(conflict) })
                            : keybindings[id] ? formatCombo(keybindings[id]) : t('settings.shortcutSection.none')}
                      </span>
                    </div>
                    <div className="settings-row-actions">
                      <button className={`test-btn ${recording === id ? 'ok' : ''}`} onClick={() => setRecording(recording === id ? null : id)}>
                        {recording === id ? t('settings.shortcutSection.cancel') : t('settings.shortcutSection.change')}
                      </button>
                      <button className="test-btn" onClick={() => resetKeybinding(id)} disabled={keybindings[id] === DEFAULT_KEYBINDINGS[id]}>
                        {t('settings.shortcutSection.reset')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeSection === 'data' && (
          <div className="settings-section">
            <h2>{t('settings.dataSection.title')}</h2>
            <p className="settings-desc">{t('settings.dataSection.desc')}</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.dataSection.export')}</span><span className="settings-row-desc">{t('settings.dataSection.exportDesc')}</span></div>
                <button className="btn-action" onClick={() => { const data = { _note: t('settings.dataSection.exportKeyNote'), providers: providers.map((p) => { const { apiKey, ...rest } = p; return rest }), models, settings: { routingMode, defaultSendMode } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'pawn-settings.json'; a.click(); URL.revokeObjectURL(url) }}>{t('settings.dataSection.export')}</button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><span className="settings-row-label">{t('settings.dataSection.import')}</span><span className="settings-row-desc">{t('settings.dataSection.importDesc')}</span></div>
                <button className="btn-action" onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const text = await file.text(); try { const data = JSON.parse(text); const store = useProviderStore.getState(); if (data.providers) data.providers.forEach((p: typeof providers[0]) => store.addProvider(p)); if (data.models) data.models.forEach((m: typeof models[0]) => store.addModel(m)) } catch {} }; input.click() }}>{t('settings.dataSection.import')}</button>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.configFile')}</span>
                  <span className="settings-row-desc">{t('settings.dataSection.configFileDesc')}</span>
                  {pawnPaths?.configPath && <span className="plugin-source">{pawnPaths.configPath}</span>}
                </div>
                <div className="settings-row-actions">
                  <button className="btn-action" disabled={!pawnPaths?.configPath} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.configPath) }}>
                    {t('settings.dataSection.open')}
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.database')}</span>
                  <span className="settings-row-desc">{t('settings.dataSection.databaseDesc')}</span>
                  {pawnPaths?.dataDir && <span className="plugin-source">{pawnPaths.dataDir}</span>}
                </div>
                <div className="settings-row-actions">
                  <button className="btn-action" disabled={!pawnPaths?.dataDir} onClick={() => { if (pawnPaths) void window.api.workspace.openPath(pawnPaths.dataDir) }}>
                    {t('settings.dataSection.open')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`${confirmDelete.name} ${t('common.delete')}`}
          message={
            confirmDelete.type === 'provider'
              ? t('confirmDialog.deleteProviderConfirm')
              : confirmDelete.type === 'model'
                ? t('confirmDialog.deleteModelConfirm')
                : t('confirmDialog.deleteRoutineConfirm')
          }
          confirmLabel={t('confirmDialog.confirm')}
          cancelLabel={t('confirmDialog.cancel')}
          onConfirm={() => { void handleConfirmDelete() }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
