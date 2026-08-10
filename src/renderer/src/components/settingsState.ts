import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useMcpStore } from '../stores/mcp'
import { usePrefsStore } from '../stores/prefs'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import {
  KEYBINDING_IDS, DEFAULT_KEYBINDINGS, comboToString, formatCombo,
  useKeybindingsStore, type KeyBindingId
} from '../stores/keybindings'
import { guessPricing, guessSupportsVision, type ApiFormat, type ModelPricing, type Provider } from '../types/provider'
import { PROVIDER_PRESETS, type ProviderPreset } from '../agent/providerPresets'
import {
  authHeadersForChat,
  buildTestRequestBody,
  pickTestModelId,
  providerChatUrl,
  summarizeProviderError
} from '../agent/testProvider'
import { loadProjectContext, skillSummary, type LoadedSkill } from '../agent/skills'
import { isSkillEnabled, loadDisabledSkillNames, setSkillEnabled } from '../utils/skillVisibility'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { MCP_TEMPLATES } from '../agent/mcpTemplates'
import {
  SECTIONS,
  type SettingsDeleteTarget,
  type SettingsSection,
  type SettingsSkillScope,
  type SourceSignal,
  type SourceSignalId
} from './settingsMeta'

/**
 * All Settings page state + handlers, extracted from Settings.tsx so the view
 * stays a thin presentational shell. Returns every binding the JSX needs.
 */
export function useSettingsState({ onSidebarWidthChange }: { onSidebarWidthChange: (width: number) => void }) {
  // --- body (state, effects, handlers) ---
  const { t, i18n } = useTranslation()
  const { theme, set } = useThemeStore()
  const { servers: mcpServers, toggleServer: toggleMcpServer } = useMcpStore()
  const {
    sleepPrevention,
    setSleepPrevention,
    taskNotificationsEnabled,
    setTaskNotificationsEnabled,
    confirmQuit,
    setConfirmQuit,
    sessionBudgetUsd,
    setSessionBudgetUsd,
    dailyBudgetUsd,
    setDailyBudgetUsd,
    checkUpdatesOnLaunch,
    setCheckUpdatesOnLaunch
  } = usePrefsStore()
  const [updateMsg, setUpdateMsg] = useState('')
  const [updateChecking, setUpdateChecking] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const [importMsg, setImportMsg] = useState('')
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
    providers, models, routingMode, defaultSendMode, permissionMode, visionModelId,
    addProvider, removeProvider, updateProvider,
    addModel, removeModel, updateModel, syncModelsFromProvider,
    setRoutingMode, setDefaultSendMode, setPermissionMode,
    shellSandbox, setShellSandbox, shellNetwork, setShellNetwork,
    shellCwdJail, setShellCwdJail, autoMemoryConsolidate, setAutoMemoryConsolidate,
    setVisionModel
  } = useProviderStore()

  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [presetPicking, setPresetPicking] = useState<ProviderPreset | null>(null)
  const [presetKey, setPresetKey] = useState('')
  const [showAddModel, setShowAddModel] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    name: '',
    apiFormat: 'openai' as ApiFormat,
    baseUrl: '',
    apiKey: ''
  })
  const [modelForm, setModelForm] = useState({
    providerId: '', modelId: '', label: '', tier: 'mid' as 'low' | 'mid' | 'high',
    input: '', output: '', cacheRead: '', cacheWrite: '', contextWindow: '',
    /** '' = auto-guess, 'yes' | 'no' = explicit */
    vision: '' as '' | 'yes' | 'no'
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
  type ConnProvider = 'google' | 'github' | 'gitlab' | 'codecommit'
  type PatConnProvider = 'gitlab' | 'codecommit'
  const [connStatus, setConnStatus] = useState<Array<{
    provider: ConnProvider
    connected: boolean
    accountLabel?: string
    clientConfigured: boolean
    authMode?: 'oauth' | 'pat'
    hostHint?: string
    writeScopesReady?: boolean
    writeScopesMissing?: string[]
  }>>([])
  const [connBusy, setConnBusy] = useState<ConnProvider | null>(null)
  const [connMsg, setConnMsg] = useState('')
  const [deviceAuth, setDeviceAuth] = useState<{
    provider: ConnProvider
    userCode: string
    verificationUri: string
  } | null>(null)
  const [patFormOpen, setPatFormOpen] = useState<PatConnProvider | null>(null)
  const [patForm, setPatForm] = useState({
    baseUrl: '',
    token: '',
    region: 'ap-northeast-2',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: ''
  })
  const { projects, activeProjectId } = useAppStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectPath = getEffectiveProjectPath(activeProject, useAppStore.getState().activeSessionId)

  const applyModelIdGuess = (modelId: string): void => {
    const guess = guessPricing(modelId)
    const visionGuess = guessSupportsVision(modelId)
    setModelForm((f) => ({
      ...f,
      modelId,
      tier: guess?.tier || f.tier,
      input: guess ? String(guess.input) : f.input,
      output: guess ? String(guess.output) : f.output,
      cacheRead: guess ? String(guess.cacheRead) : f.cacheRead,
      cacheWrite: guess ? String(guess.cacheWrite) : f.cacheWrite,
      contextWindow: guess ? String(guess.contextWindow) : f.contextWindow,
      // Only auto-fill vision when the user has not set it explicitly yet.
      vision: f.vision === '' && visionGuess !== undefined
        ? (visionGuess ? 'yes' : 'no')
        : f.vision
    }))
  }

  const visionCandidates = useMemo(
    () => models.filter((m) => m.enabled && m.supportsVision !== false),
    [models]
  )

  const handleAddFromPreset = async (preset: ProviderPreset, apiKey: string): Promise<void> => {
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
          contextWindow: guess?.contextWindow,
          supportsVision: guessSupportsVision(m.modelId)
        })
      }
      // Best-effort live catalog sync so seeds are not the long-term source of truth.
      setSyncingId(created.id)
      try {
        const r = await syncModelsFromProvider(created.id)
        setSyncResult((s) => ({
          ...s,
          [created.id]: t('settings.providerSection.syncOk', {
            added: r.added,
            updated: r.updated,
            total: r.remoteCount
          })
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setSyncResult((s) => ({
          ...s,
          [created.id]: t('settings.providerSection.syncSeedOnly', { error: msg.slice(0, 120) })
        }))
      } finally {
        setSyncingId(null)
      }
    }
    setPresetPicking(null)
    setPresetKey('')
  }

  const handleSyncModels = async (providerId: string): Promise<void> => {
    setSyncingId(providerId)
    setSyncResult((s) => ({ ...s, [providerId]: '' }))
    try {
      const r = await syncModelsFromProvider(providerId)
      setSyncResult((s) => ({
        ...s,
        [providerId]: t('settings.providerSection.syncOk', {
          added: r.added,
          updated: r.updated,
          total: r.remoteCount
        })
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSyncResult((s) => ({
        ...s,
        [providerId]: t('settings.providerSection.syncFail', { error: msg.slice(0, 160) })
      }))
    } finally {
      setSyncingId(null)
    }
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
    const supportsVision = modelForm.vision === 'yes'
      ? true
      : modelForm.vision === 'no'
        ? false
        : guessSupportsVision(modelForm.modelId.trim())
    addModel({
      id: '',
      providerId: modelForm.providerId,
      modelId: modelForm.modelId.trim(),
      label: modelForm.label.trim() || modelForm.modelId.trim(),
      tier: modelForm.tier,
      enabled: true,
      pricing,
      contextWindow: num(modelForm.contextWindow),
      supportsVision
    })
    setModelForm({
      providerId: '', modelId: '', label: '', tier: 'mid',
      input: '', output: '', cacheRead: '', cacheWrite: '', contextWindow: '', vision: ''
    })
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
      const modelId = pickTestModelId(providerId, models, p.apiFormat)
      if (!modelId) {
        setTestResult((r) => ({ ...r, [providerId]: 'FAIL: no model' }))
        return
      }
      const url = providerChatUrl(p)
      const headers = authHeadersForChat(p)
      const body = buildTestRequestBody(p.apiFormat, modelId)
      const isBrowser = window.api?.platform === 'browser'
      let response: Response
      if (isBrowser) {
        response = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, headers, body: JSON.stringify(body) })
        })
      } else {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
      }
      if (response.ok) {
        setTestResult((r) => ({ ...r, [providerId]: 'OK' }))
      } else {
        const text = await response.text().catch(() => '')
        setTestResult((r) => ({
          ...r,
          [providerId]: summarizeProviderError(response.status, text)
        }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ERROR'
      setTestResult((r) => ({ ...r, [providerId]: `ERROR: ${msg.slice(0, 60)}` }))
    } finally {
      setTestingId(null)
    }
  }

  const languages = [{ code: 'en', label: 'English' }, { code: 'ko', label: '한국어' }, { code: 'ja', label: '日本語' }, { code: 'zh', label: '中文' }]

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
    }
    setConfirmDelete(null)
  }

  const refreshConnections = async (): Promise<void> => {
    if (!window.api.connections) return
    try {
      const list = await window.api.connections.list()
      setConnStatus(list || [])
    } catch { /* desktop-only */ }
  }

  useEffect(() => {
    if (activeSection === 'connections') void refreshConnections()
  }, [activeSection])

  useEffect(() => {
    if (!window.api.connections?.onProgress) return
    return window.api.connections.onProgress((payload) => {
      if (payload.phase === 'device_code' || payload.phase === 'polling') {
        if (payload.userCode) {
          setDeviceAuth({
            provider: payload.provider,
            userCode: payload.userCode,
            verificationUri: payload.verificationUri || 'https://github.com/login/device'
          })
        }
      }
      if (payload.phase === 'browser' && payload.message) {
        setConnMsg(payload.message)
      }
    })
  }, [])

  const handleConnect = async (provider: 'google' | 'github'): Promise<void> => {
    if (!window.api.connections) {
      setConnMsg(t('settings.connectionsSection.desktopOnly'))
      return
    }
    setConnBusy(provider)
    setConnMsg(t('settings.connectionsSection.connectingHint'))
    setDeviceAuth(null)
    setPatFormOpen(null)
    try {
      const res = await window.api.connections.connect(provider)
      if (res.cancelled) {
        setConnMsg(t('settings.connectionsSection.cancelled'))
      } else if (res.error && res.error !== 'Cancelled') {
        setConnMsg(res.error)
      } else if (res.ok) {
        setConnMsg(t('settings.connectionsSection.connected', { account: res.accountLabel || provider }))
      }
      await refreshConnections()
    } catch (e) {
      setConnMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setConnBusy(null)
      setDeviceAuth(null)
    }
  }

  const openPatForm = (provider: PatConnProvider): void => {
    setPatFormOpen(provider)
    setConnMsg('')
    setDeviceAuth(null)
    setPatForm({
      baseUrl: provider === 'gitlab' ? 'https://gitlab.com' : '',
      token: '',
      region: 'ap-northeast-2',
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: ''
    })
  }

  const handleConnectPat = async (provider: PatConnProvider): Promise<void> => {
    if (!window.api.connections?.connectPat) {
      setConnMsg(t('settings.connectionsSection.desktopOnly'))
      return
    }
    setConnBusy(provider)
    setConnMsg(t('settings.connectionsSection.patConnecting'))
    try {
      const credentials =
        provider === 'gitlab'
          ? { baseUrl: patForm.baseUrl.trim(), token: patForm.token.trim() }
          : {
              region: patForm.region.trim(),
              accessKeyId: patForm.accessKeyId.trim(),
              secretAccessKey: patForm.secretAccessKey.trim(),
              sessionToken: patForm.sessionToken.trim() || undefined
            }
      const res = await window.api.connections.connectPat(provider, credentials)
      if (res.error) {
        setConnMsg(res.error)
      } else if (res.ok) {
        setConnMsg(t('settings.connectionsSection.connected', { account: res.accountLabel || provider }))
        setPatFormOpen(null)
        setPatForm({
          baseUrl: '',
          token: '',
          region: 'ap-northeast-2',
          accessKeyId: '',
          secretAccessKey: '',
          sessionToken: ''
        })
      }
      await refreshConnections()
    } catch (e) {
      setConnMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setConnBusy(null)
    }
  }

  const handleCancelConnect = async (provider: ConnProvider): Promise<void> => {
    if (!window.api.connections?.cancel) return
    await window.api.connections.cancel(provider)
    setConnMsg(t('settings.connectionsSection.cancelled'))
    setDeviceAuth(null)
    // connect() promise will settle and clear connBusy
  }

  const handleDisconnect = async (provider: ConnProvider): Promise<void> => {
    if (!window.api.connections) return
    setConnBusy(provider)
    setConnMsg('')
    setDeviceAuth(null)
    if (patFormOpen === provider) setPatFormOpen(null)
    try {
      await window.api.connections.disconnect(provider)
      setConnMsg(t('settings.connectionsSection.disconnected', { provider }))
      await refreshConnections()
    } finally {
      setConnBusy(null)
    }
  }

  const connProviderLabel = (provider: ConnProvider): string => {
    if (provider === 'google') return t('settings.connectionsSection.google')
    if (provider === 'github') return t('settings.connectionsSection.github')
    if (provider === 'gitlab') return t('settings.connectionsSection.gitlab')
    return t('settings.connectionsSection.codecommit')
  }

  const copyDeviceCode = async (): Promise<void> => {
    if (!deviceAuth?.userCode) return
    try {
      await navigator.clipboard.writeText(deviceAuth.userCode)
      setConnMsg(t('settings.connectionsSection.codeCopied'))
    } catch { /* ignore */ }
  }

  return {
    t, i18n,
    theme, set,
    mcpServers, toggleMcpServer,
    sleepPrevention, setSleepPrevention, taskNotificationsEnabled, setTaskNotificationsEnabled,
    confirmQuit, setConfirmQuit, sessionBudgetUsd, setSessionBudgetUsd, dailyBudgetUsd, setDailyBudgetUsd,
    checkUpdatesOnLaunch, setCheckUpdatesOnLaunch,
    updateMsg, setUpdateMsg, updateChecking, setUpdateChecking, backupMsg, setBackupMsg, importMsg, setImportMsg,
    keybindings, setKeybinding, resetKeybinding,
    recording, setRecording, trayVisible, setTrayVisible, navOpen, setNavOpen,
    attachResizer,
    providers, models, routingMode, defaultSendMode, permissionMode, visionModelId,
    addProvider, removeProvider, updateProvider,
    addModel, removeModel, updateModel, syncModelsFromProvider,
    setRoutingMode, setDefaultSendMode, setPermissionMode,
    shellSandbox, setShellSandbox, shellNetwork, setShellNetwork,
    shellCwdJail, setShellCwdJail, autoMemoryConsolidate, setAutoMemoryConsolidate,
    setVisionModel,
    activeSection, setActiveSection, showAddProvider, setShowAddProvider, presetPicking, setPresetPicking,
    presetKey, setPresetKey, showAddModel, setShowAddModel, testingId, setTestingId, testResult, setTestResult,
    syncingId, setSyncingId, syncResult, setSyncResult, form, setForm, modelForm, setModelForm,
    homeDir, setHomeDir, loadedSkills, setLoadedSkills, skillsLoading, setSkillsLoading,
    skillScope, setSkillScope, skillSearch, setSkillSearch, disabledSkills, setDisabledSkills,
    contextSignals, setContextSignals, contextAdditionCount, setContextAdditionCount,
    mcpLoading, setMcpLoading, showAddMcpServer, setShowAddMcpServer, mcpForm, setMcpForm, mcpScope, setMcpScope,
    mcpFormError, setMcpFormError, mcpAdding, setMcpAdding, confirmDelete, setConfirmDelete,
    pawnPaths, setPawnPaths, connStatus, setConnStatus, connBusy, setConnBusy, connMsg, setConnMsg,
    deviceAuth, setDeviceAuth, patFormOpen, setPatFormOpen, patForm, setPatForm,
    activeProject, activeProjectId, projectPath,
    applyModelIdGuess, visionCandidates, handleAddFromPreset, handleSyncModels, handleAddProvider, handleAddModel,
    handleAddMcpServer, handleRemoveMcpServer, handleTestProvider, shortcutLabel, comboConflict,
    fileExists, countMarkdownFiles, countSubdirs, detectContextSignals, groups, visibleSkills, scopeCounts,
    enabledSkillCount, toggleSkill, handleConfirmDelete, refreshConnections, handleConnect, openPatForm,
    handleConnectPat, handleCancelConnect, handleDisconnect, connProviderLabel, copyDeviceCode, languages
  }
}
