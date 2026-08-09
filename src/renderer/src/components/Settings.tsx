import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderStore } from '../stores/provider'
import { useThemeStore } from '../stores/theme'
import { useMcpStore } from '../stores/mcp'
import { usePrefsStore } from '../stores/prefs'
import { useAppStore } from '../stores/app'
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
import ConfirmDialog from './ConfirmDialog'
import NavControls from './NavControls'
import MemorySettingsPanel from './MemorySettingsPanel'
import HooksSettingsPanel from './HooksSettingsPanel'
import AgentsSettingsPanel from './AgentsSettingsPanel'
import PermissionsAlwaysPanel from './PermissionsAlwaysPanel'
import UsageSettingsPanel from './UsageSettingsPanel'
import logoGitlab from '../assets/logos/gitlab.svg'
import logoCodeCommit from '../assets/logos/codecommit.svg'
import { MCP_TEMPLATES } from '../agent/mcpTemplates'
import './Settings.css'

type SettingsSection =
  | 'appearance'
  | 'providers'
  | 'models'
  | 'agent'
  | 'memory'
  | 'hooks'
  | 'subagents'
  | 'plugins'
  | 'mcp'
  | 'connections'
  | 'system'
  | 'shortcuts'
  | 'data'
  | 'usage'
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
  // Coding: split former mega “Agent” page into focused sections
  { id: 'agent', labelKey: 'settings.agent', groupKey: 'settings.groups.coding', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'memory', labelKey: 'settings.memory', groupKey: 'settings.groups.coding', icon: 'M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7zm-1 18h2v2h-2v-2z' },
  { id: 'hooks', labelKey: 'settings.hooks', groupKey: 'settings.groups.coding', icon: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71' },
  { id: 'subagents', labelKey: 'settings.subagents', groupKey: 'settings.groups.coding', icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { id: 'plugins', labelKey: 'settings.plugins', groupKey: 'settings.groups.integration', icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
  { id: 'mcp', labelKey: 'settings.mcp', groupKey: 'settings.groups.integration', icon: 'M20 7H4a2 2 0 00-2 2v1a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM6 11h.01M20 15H4a2 2 0 00-2 2v1a2 2 0 002 2h16a2 2 0 002-2v-1a2 2 0 00-2-2zM6 19h.01' },
  { id: 'connections', labelKey: 'settings.connections', groupKey: 'settings.groups.integration', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
  { id: 'system', labelKey: 'settings.system', groupKey: 'settings.groups.system', icon: 'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z' },
  { id: 'shortcuts', labelKey: 'settings.shortcuts', groupKey: 'settings.groups.system', icon: 'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM7 8h10M7 12h4' },
  { id: 'data', labelKey: 'settings.data', groupKey: 'settings.groups.general', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' },
  {
    id: 'usage',
    labelKey: 'settings.usage',
    groupKey: 'settings.groups.general',
    icon: 'M3 3v18h18M7 14l3-3 3 2 5-6'
  },
]

export default function Settings({
  onSidebarWidthChange, canGoBack, canGoForward, onGoBack, onGoForward
}: SettingsProps): React.JSX.Element {
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
  const projectPath = activeProject?.paths?.[0] || ''

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
                    {syncResult[p.id] && (
                      <span className="settings-row-desc sync-result" title={syncResult[p.id]}>
                        {syncResult[p.id]}
                      </span>
                    )}
                  </div>
                  <div className="settings-row-actions">
                    <button
                      className="test-btn"
                      onClick={() => handleSyncModels(p.id)}
                      disabled={syncingId === p.id}
                      title={t('settings.providerSection.syncHint')}
                    >
                      {syncingId === p.id ? '...' : t('settings.providerSection.syncModels')}
                    </button>
                    <button
                      className={`test-btn ${testResult[p.id] === 'OK' ? 'ok' : testResult[p.id]?.startsWith('FAIL') || testResult[p.id]?.startsWith('ERROR') ? 'fail' : ''}`}
                      onClick={() => handleTestProvider(p.id)}
                      disabled={testingId === p.id}
                      title={testResult[p.id] || undefined}
                    >
                      {testingId === p.id ? '...' : testResult[p.id] || 'Test'}
                    </button>
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
              {models.map((m) => {
                const visionState = m.supportsVision === true ? 'yes' : m.supportsVision === false ? 'no' : 'auto'
                return (
                  <div key={m.id} className="settings-row model-row">
                    <div className="settings-row-info">
                      <span className="settings-row-label">
                        {m.label || m.modelId}
                        {m.supportsVision === true && (
                          <span className="settings-badge vision-badge vision-yes" title={t('settings.modelSection.visionYes')}>
                            {t('settings.modelSection.visionBadge')}
                          </span>
                        )}
                        {m.supportsVision === false && (
                          <span className="settings-badge vision-badge vision-no" title={t('settings.modelSection.visionNo')}>
                            {t('settings.modelSection.visionTextOnly')}
                          </span>
                        )}
                      </span>
                      <span className="settings-row-desc">
                        {providers.find((p) => p.id === m.providerId)?.name} / {m.tier}
                        {m.pricing
                          ? t('settings.modelSection.pricingFormat', { input: m.pricing.input, output: m.pricing.output })
                          : t('settings.modelSection.pricingUnknown')}
                      </span>
                    </div>
                    <div className="settings-row-actions">
                      <select
                        className="vision-select"
                        value={visionState}
                        aria-label={t('settings.modelSection.visionLabel')}
                        title={t('settings.modelSection.visionHint')}
                        onChange={(e) => {
                          const v = e.target.value
                          updateModel(m.id, {
                            supportsVision: v === 'yes' ? true : v === 'no' ? false : undefined
                          })
                        }}
                      >
                        <option value="auto">{t('settings.modelSection.visionAuto')}</option>
                        <option value="yes">{t('settings.modelSection.visionYes')}</option>
                        <option value="no">{t('settings.modelSection.visionNo')}</option>
                      </select>
                      <button className="delete-btn" onClick={() => setConfirmDelete({ type: 'model', id: m.id, name: m.label || m.modelId })}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </div>
                  </div>
                )
              })}
              {models.length === 0 && <div className="settings-empty">{t('settings.modelSection.empty')}</div>}
            </div>
            {showAddModel ? (
              <div className="settings-card add-form">
                <select value={modelForm.providerId} onChange={(e) => setModelForm({ ...modelForm, providerId: e.target.value })}><option value="">{t('settings.modelSection.selectProvider')}</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input placeholder={t('settings.modelSection.modelIdPlaceholder')} value={modelForm.modelId} onChange={(e) => applyModelIdGuess(e.target.value)} />
                <input placeholder={t('settings.modelSection.displayNamePlaceholder')} value={modelForm.label} onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })} />
                <select value={modelForm.tier} onChange={(e) => setModelForm({ ...modelForm, tier: e.target.value as 'low' | 'mid' | 'high' })}><option value="low">{t('settings.modelSection.tierLow')}</option><option value="mid">{t('settings.modelSection.tierMid')}</option><option value="high">{t('settings.modelSection.tierHigh')}</option></select>
                <label className="settings-field-label">{t('settings.modelSection.visionLabel')}</label>
                <select value={modelForm.vision} onChange={(e) => setModelForm({ ...modelForm, vision: e.target.value as '' | 'yes' | 'no' })}>
                  <option value="">{t('settings.modelSection.visionAuto')}</option>
                  <option value="yes">{t('settings.modelSection.visionYes')}</option>
                  <option value="no">{t('settings.modelSection.visionNo')}</option>
                </select>
                <div className="settings-row-desc">{t('settings.modelSection.visionHint')}</div>
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
              <div className="settings-row settings-row-stack">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.visionFallback')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.visionFallbackDesc')}</span>
                </div>
                <select
                  className="vision-fallback-select"
                  value={visionModelId || ''}
                  onChange={(e) => setVisionModel(e.target.value || null)}
                >
                  <option value="">{t('settings.agentSection.visionFallbackAuto')}</option>
                  {visionCandidates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.modelId}
                      {providers.find((p) => p.id === m.providerId) ? ` · ${providers.find((p) => p.id === m.providerId)!.name}` : ''}
                    </option>
                  ))}
                </select>
                {visionCandidates.length === 0 && (
                  <div className="settings-row-desc vision-fallback-warn">
                    {t('settings.agentSection.visionFallbackEmpty')}
                  </div>
                )}
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
              <PermissionsAlwaysPanel />
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.shellSandbox')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.shellSandboxDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={shellSandbox} onChange={(e) => setShellSandbox(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.shellNetwork')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.shellNetworkDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={shellNetwork} onChange={(e) => setShellNetwork(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.cwdJail')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.cwdJailDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={shellCwdJail} onChange={(e) => setShellCwdJail(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.agentSection.autoMemoryConsolidate')}</span>
                  <span className="settings-row-desc">{t('settings.agentSection.autoMemoryConsolidateDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={autoMemoryConsolidate} onChange={(e) => setAutoMemoryConsolidate(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'memory' && (
          <div className="settings-section">
            <h2>{t('settings.memorySection.title')}</h2>
            <p className="settings-desc">{t('settings.memorySection.desc')}</p>
            <MemorySettingsPanel />
          </div>
        )}

        {activeSection === 'hooks' && (
          <div className="settings-section">
            <h2>{t('settings.hooksSection.title')}</h2>
            <p className="settings-desc">{t('settings.hooksSection.desc')}</p>
            <HooksSettingsPanel />
          </div>
        )}

        {activeSection === 'subagents' && (
          <div className="settings-section">
            <h2>{t('settings.agentsSection.title')}</h2>
            <AgentsSettingsPanel />
          </div>
        )}

        {activeSection === 'usage' && (
          <div className="settings-section">
            <h2>{t('settings.usageSection.title')}</h2>
            <UsageSettingsPanel />
            <div className="settings-card" style={{ marginTop: 16 }}>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.usageSection.sessionBudget')}</span>
                  <span className="settings-row-desc">{t('settings.usageSection.sessionBudgetDesc')}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ width: 96 }}
                  value={sessionBudgetUsd || ''}
                  placeholder="0"
                  onChange={(e) => setSessionBudgetUsd(Number(e.target.value) || 0)}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.usageSection.dailyBudget')}</span>
                  <span className="settings-row-desc">{t('settings.usageSection.dailyBudgetDesc')}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ width: 96 }}
                  value={dailyBudgetUsd || ''}
                  placeholder="0"
                  onChange={(e) => setDailyBudgetUsd(Number(e.target.value) || 0)}
                />
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
              <div className="settings-row-info" style={{ marginBottom: 8 }}>
                <span className="settings-row-label">{t('settings.mcpSection.templates')}</span>
                <span className="settings-row-desc">
                  One-click install common MCP servers (stdio or HTTP). Add secrets in env after install.
                </span>
              </div>
              <div className="mcp-templates" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {MCP_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="test-btn"
                    title={tpl.description}
                    disabled={mcpAdding || (tpl.scope === 'project' && !projectPath)}
                    onClick={() => {
                      void (async () => {
                        setMcpAdding(true)
                        setMcpFormError(null)
                        const res = await useMcpStore.getState().addServer(
                          tpl.scope,
                          tpl.scope === 'project' ? projectPath || undefined : undefined,
                          tpl.id,
                          tpl.input as McpServerInput
                        )
                        setMcpAdding(false)
                        if (!res.ok) setMcpFormError(res.error || 'Template install failed')
                        else void useMcpStore.getState().refresh(projectPath || undefined)
                      })()
                    }}
                  >
                    + {tpl.name}
                  </button>
                ))}
              </div>
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
                    {!server.disabled && server.status === 'error' && (
                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={() => void useMcpStore.getState().reconnect(projectPath || undefined)}
                      >
                        {t('settings.mcpSection.retry')}
                      </button>
                    )}
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


        {activeSection === 'connections' && (
          <div className="settings-section">
            <h2>{t('settings.connectionsSection.title')}</h2>
            <p className="settings-desc">{t('settings.connectionsSection.desc')}</p>

            <div className="settings-card conn-card">
              {(['google', 'github', 'gitlab', 'codecommit'] as const).map((provider) => {
                const st = connStatus.find((s) => s.provider === provider)
                const connected = !!st?.connected
                const ready = st?.clientConfigured !== false
                const busy = connBusy === provider
                const isPat = provider === 'gitlab' || provider === 'codecommit'
                const patOpen = isPat && patFormOpen === provider
                return (
                  <div key={provider} className="conn-provider-block">
                    <div className="settings-row conn-row">
                      <div className="conn-brand">
                        {provider === 'google' ? (
                          <span className="conn-logo conn-logo-google" aria-hidden>
                            <svg width="22" height="22" viewBox="0 0 24 24">
                              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                          </span>
                        ) : provider === 'github' ? (
                          <span className="conn-logo conn-logo-github" aria-hidden>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                            </svg>
                          </span>
                        ) : provider === 'gitlab' ? (
                          <span className="conn-logo conn-logo-gitlab" aria-hidden>
                            <img src={logoGitlab} alt="" width={22} height={22} draggable={false} />
                          </span>
                        ) : (
                          <span className="conn-logo conn-logo-codecommit" aria-hidden>
                            <img src={logoCodeCommit} alt="" width={40} height={40} draggable={false} />
                          </span>
                        )}
                        <div className="settings-row-info">
                          <span className="settings-row-label">
                            {connProviderLabel(provider)}
                            {isPat && (
                              <span className="settings-badge conn-pat-badge">
                                {t('settings.connectionsSection.patBadge')}
                              </span>
                            )}
                            {connected && (
                              <span className="settings-badge conn-account-badge">
                                {st?.accountLabel || t('settings.connectionsSection.statusConnected')}
                              </span>
                            )}
                          </span>
                          <span className="settings-row-desc">
                            {connected
                              ? t('settings.connectionsSection.statusConnectedDesc')
                              : busy && !isPat
                                ? t('settings.connectionsSection.waitingBrowser')
                                : isPat
                                  ? t('settings.connectionsSection.statusDisconnectedPat')
                                  : t('settings.connectionsSection.statusDisconnected')}
                            {provider === 'google' && connected && st?.writeScopesReady === false && (
                              <span className="conn-write-scope-warn">
                                {' '}
                                · Write scopes missing
                                {st.writeScopesMissing?.length
                                  ? ` (${st.writeScopesMissing.join(', ')})`
                                  : ''}
                                . Disconnect → Connect to enable Gmail send / Sheets write / Calendar create.
                              </span>
                            )}
                            {provider === 'google' && connected && st?.writeScopesReady === true && (
                              <span className="conn-write-scope-ok"> · Write scopes ready</span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="settings-row-actions">
                        {connected ? (
                          <button
                            className="test-btn"
                            disabled={busy}
                            onClick={() => void handleDisconnect(provider)}
                          >
                            {t('settings.connectionsSection.disconnect')}
                          </button>
                        ) : busy && !isPat ? (
                          <button
                            className="test-btn conn-cancel-btn"
                            onClick={() => void handleCancelConnect(provider)}
                          >
                            {t('settings.connectionsSection.cancel')}
                          </button>
                        ) : isPat ? (
                          <button
                            className={`btn-primary conn-connect-btn conn-connect-${provider}`}
                            disabled={busy}
                            onClick={() => {
                              if (patOpen) setPatFormOpen(null)
                              else openPatForm(provider)
                            }}
                          >
                            {patOpen
                              ? t('settings.connectionsSection.cancel')
                              : t('settings.connectionsSection.connect')}
                          </button>
                        ) : (
                          <button
                            className={`btn-primary conn-connect-btn conn-connect-${provider}`}
                            disabled={!ready}
                            onClick={() => void handleConnect(provider)}
                          >
                            {t('settings.connectionsSection.connect')}
                          </button>
                        )}
                      </div>
                    </div>

                    {patOpen && (
                      <div className="conn-pat-panel">
                        <div className="conn-pat-title">
                          {provider === 'gitlab'
                            ? t('settings.connectionsSection.gitlabPatTitle')
                            : t('settings.connectionsSection.codecommitPatTitle')}
                        </div>
                        <p className="conn-pat-hint">
                          {provider === 'gitlab'
                            ? t('settings.connectionsSection.gitlabPatHint')
                            : t('settings.connectionsSection.codecommitPatHint')}
                        </p>
                        {provider === 'gitlab' ? (
                          <div className="conn-pat-fields">
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.baseUrl')}</span>
                              <input
                                type="url"
                                autoComplete="off"
                                placeholder="https://gitlab.example.com"
                                value={patForm.baseUrl}
                                onChange={(e) => setPatForm((f) => ({ ...f, baseUrl: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.personalToken')}</span>
                              <input
                                type="password"
                                autoComplete="off"
                                placeholder="glpat-…"
                                value={patForm.token}
                                onChange={(e) => setPatForm((f) => ({ ...f, token: e.target.value }))}
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="conn-pat-fields">
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsRegion')}</span>
                              <input
                                type="text"
                                autoComplete="off"
                                placeholder="ap-northeast-2"
                                value={patForm.region}
                                onChange={(e) => setPatForm((f) => ({ ...f, region: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsAccessKeyId')}</span>
                              <input
                                type="text"
                                autoComplete="off"
                                placeholder="AKIA…"
                                value={patForm.accessKeyId}
                                onChange={(e) => setPatForm((f) => ({ ...f, accessKeyId: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsSecretAccessKey')}</span>
                              <input
                                type="password"
                                autoComplete="off"
                                value={patForm.secretAccessKey}
                                onChange={(e) => setPatForm((f) => ({ ...f, secretAccessKey: e.target.value }))}
                              />
                            </label>
                            <label className="conn-pat-field">
                              <span>{t('settings.connectionsSection.awsSessionToken')}</span>
                              <input
                                type="password"
                                autoComplete="off"
                                placeholder={t('settings.connectionsSection.optional')}
                                value={patForm.sessionToken}
                                onChange={(e) => setPatForm((f) => ({ ...f, sessionToken: e.target.value }))}
                              />
                            </label>
                          </div>
                        )}
                        <div className="conn-pat-actions">
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={
                              busy ||
                              (provider === 'gitlab'
                                ? !patForm.baseUrl.trim() || !patForm.token.trim()
                                : !patForm.region.trim() ||
                                  !patForm.accessKeyId.trim() ||
                                  !patForm.secretAccessKey.trim())
                            }
                            onClick={() => void handleConnectPat(provider)}
                          >
                            {busy
                              ? t('settings.connectionsSection.connecting')
                              : t('settings.connectionsSection.saveConnect')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {deviceAuth && (
                <div className="conn-device-panel">
                  <div className="conn-device-title">{t('settings.connectionsSection.deviceTitle')}</div>
                  <div className="conn-device-hint">
                    {t('settings.connectionsSection.deviceHint', {
                      uri: deviceAuth.verificationUri.replace(/^https?:\/\//, '')
                    })}
                  </div>
                  <div className="conn-device-code-row">
                    <code className="conn-device-code">{deviceAuth.userCode}</code>
                    <button type="button" className="test-btn" onClick={() => void copyDeviceCode()}>
                      {t('settings.connectionsSection.copyCode')}
                    </button>
                  </div>
                  <a
                    className="conn-device-link"
                    href={deviceAuth.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.open(deviceAuth.verificationUri, '_blank')
                    }}
                  >
                    {t('settings.connectionsSection.openDevicePage')}
                  </a>
                </div>
              )}

              {connMsg && !deviceAuth && (
                <div className="conn-msg">{connMsg}</div>
              )}
              <p className="settings-row-desc conn-privacy">{t('settings.connectionsSection.privacyNote')}</p>
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
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.systemSection.confirmQuit')}</span>
                  <span className="settings-row-desc">{t('settings.systemSection.confirmQuitDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={confirmQuit}
                    onChange={(e) => setConfirmQuit(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.systemSection.checkUpdatesOnLaunch')}</span>
                  <span className="settings-row-desc">{t('settings.systemSection.checkUpdatesOnLaunchDesc')}</span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={checkUpdatesOnLaunch}
                    onChange={(e) => setCheckUpdatesOnLaunch(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.systemSection.checkUpdates')}</span>
                  <span className="settings-row-desc">
                    {updateMsg || t('settings.systemSection.checkUpdatesDesc')}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-action"
                  disabled={updateChecking}
                  onClick={() => {
                    if (!window.api?.checkForUpdates) {
                      setUpdateMsg(t('settings.systemSection.desktopOnly'))
                      return
                    }
                    setUpdateChecking(true)
                    void window.api
                      .checkForUpdates()
                      .then((r) => {
                        if (r.error && !r.latest) {
                          setUpdateMsg(r.error)
                          return
                        }
                        if (r.updateAvailable) {
                          setUpdateMsg(
                            t('settings.systemSection.updateAvailable', {
                              latest: r.latest,
                              current: r.current
                            })
                          )
                          if (r.releaseUrl) void window.api.browser?.open?.(r.releaseUrl)
                        } else {
                          setUpdateMsg(
                            t('settings.systemSection.upToDate', { current: r.current })
                          )
                        }
                      })
                      .catch((e) => setUpdateMsg(String(e)))
                      .finally(() => setUpdateChecking(false))
                  }}
                >
                  {updateChecking
                    ? t('settings.systemSection.checking')
                    : t('settings.systemSection.checkUpdates')}
                </button>
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
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.import')}</span>
                  <span className="settings-row-desc">
                    {importMsg || t('settings.dataSection.importDesc')}
                  </span>
                </div>
                <button
                  className="btn-action"
                  onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.json'
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0]
                      if (!file) return
                      const text = await file.text()
                      try {
                        const data = JSON.parse(text) as {
                          providers?: typeof providers
                          models?: typeof models
                        }
                        const store = useProviderStore.getState()
                        let n = 0
                        if (Array.isArray(data.providers)) {
                          data.providers.forEach((p) => {
                            store.addProvider(p)
                            n++
                          })
                        }
                        if (Array.isArray(data.models)) {
                          data.models.forEach((m) => {
                            store.addModel(m)
                            n++
                          })
                        }
                        if (n === 0) {
                          setImportMsg(t('settings.dataSection.importEmpty'))
                        } else {
                          setImportMsg(t('settings.dataSection.importOk', { count: n }))
                        }
                      } catch (err) {
                        setImportMsg(
                          t('settings.dataSection.importFailed', {
                            error: err instanceof Error ? err.message : String(err)
                          })
                        )
                      }
                    }
                    input.click()
                  }}
                >
                  {t('settings.dataSection.import')}
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{t('settings.dataSection.fullBackup')}</span>
                  <span className="settings-row-desc">
                    {backupMsg || t('settings.dataSection.fullBackupDesc')}
                  </span>
                </div>
                <button
                  className="btn-action"
                  onClick={() => {
                    if (!window.api?.exportBackup) {
                      setBackupMsg(t('settings.dataSection.desktopOnly'))
                      return
                    }
                    void window.api.exportBackup().then((r) => {
                      if (r.cancelled) setBackupMsg(t('settings.dataSection.backupCancelled'))
                      else if (r.ok && r.path) setBackupMsg(t('settings.dataSection.backupOk', { path: r.path }))
                      else setBackupMsg(r.error || t('settings.dataSection.backupFailed'))
                    })
                  }}
                >
                  {t('settings.dataSection.fullBackup')}
                </button>
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
              : t('confirmDialog.deleteModelConfirm')
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
