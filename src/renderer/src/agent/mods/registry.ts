/**
 * Things mods register with Pawn itself: subagent profiles (`$.agent.register`)
 * and provider/model offers (`$.provider.register`). Session-scoped; cleared
 * whenever the mod runtime reloads.
 *
 * A provider offer never changes the user's provider list on its own: it shows
 * up under Settings → Mods → "Offered providers", and only the user's click adds
 * it (disabled, without a key).
 */
import { create } from 'zustand'
import { profileFromMarkdown, sanitizeAgentName, setExtraAgentProfiles, type AgentProfile } from '../agentProfiles'

export interface ModProviderOffer {
  plugin: string
  id: string
  name: string
  apiFormat: 'openai' | 'claude'
  baseUrl: string
  models: Array<{ modelId: string; label: string; contextWindow?: number; supportsTools?: boolean }>
}

interface ModRegistryState {
  agents: AgentProfile[]
  providers: ModProviderOffer[]
  putAgent: (profile: AgentProfile) => void
  removeAgent: (name: string) => void
  putProvider: (offer: ModProviderOffer) => void
  removeProvider: (plugin: string, id: string) => void
  clear: () => void
}

export const useModRegistry = create<ModRegistryState>((set, get) => ({
  agents: [],
  providers: [],
  putAgent: (profile) => set({ agents: [...get().agents.filter((a) => a.name !== profile.name), profile] }),
  removeAgent: (name) => set({ agents: get().agents.filter((a) => a.name !== name) }),
  putProvider: (offer) =>
    set({
      providers: [...get().providers.filter((p) => !(p.plugin === offer.plugin && p.id === offer.id)), offer]
    }),
  removeProvider: (plugin, id) =>
    set({ providers: get().providers.filter((p) => !(p.plugin === plugin && p.id === id)) }),
  clear: () => set({ agents: [], providers: [] })
}))

setExtraAgentProfiles(() => useModRegistry.getState().agents)

const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/

/** Mod agent names are prefixed with the mod name so they never replace a built-in or disk agent. */
export function modAgentName(plugin: string, name: string): string {
  return `${sanitizeAgentName(plugin)}-${sanitizeAgentName(name)}`.slice(0, 64)
}

export function buildModAgent(
  plugin: string,
  root: string,
  spec: {
    name?: string
    description?: string
    prompt?: string
    markdown?: string
    tools?: string[]
    disallowedTools?: string[]
    model?: string
    maxTurns?: number
  }
): AgentProfile {
  let base: AgentProfile | null = null
  if (typeof spec.markdown === 'string' && spec.markdown.trim()) {
    // Claude Code agent file (frontmatter + body).
    base = profileFromMarkdown(spec.markdown.slice(0, 64_000), String(spec.name || 'agent'), 'user', `${root}/agents`)
  }
  const rawName = String(spec.name || base?.name || '').trim()
  if (!rawName || !ID.test(sanitizeAgentName(rawName))) throw new Error(`Invalid agent name: ${rawName}`)
  const prompt = String(spec.prompt ?? base?.systemPrompt ?? '').trim()
  if (!prompt) throw new Error('agent needs a prompt (or markdown with a body)')
  const list = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((x) => String(x)).filter((x) => /^[A-Za-z0-9_.:-]{1,80}$/.test(x)).slice(0, 64) : undefined
  const maxTurns = Math.min(25, Math.max(1, Math.floor(Number(spec.maxTurns ?? base?.maxTurns ?? 12) || 12)))
  return {
    name: modAgentName(plugin, rawName),
    description: String(spec.description || base?.description || `Agent from mod ${plugin}`).slice(0, 300),
    systemPrompt: prompt.slice(0, 32_000),
    tools: list(spec.tools) ?? base?.tools,
    disallowedTools: list(spec.disallowedTools) ?? base?.disallowedTools,
    model: ((spec.model as AgentProfile['model']) || base?.model || 'inherit') as AgentProfile['model'],
    maxTurns,
    // A mod agent never writes to the main tree: it works in a worktree and the user applies.
    isolation: 'worktree',
    apply: 'none',
    thoroughness: base?.thoroughness,
    skills: base?.skills,
    source: 'mod',
    sourcePath: `${root} (mod ${plugin})`
  }
}

export function buildProviderOffer(plugin: string, spec: Record<string, unknown>): ModProviderOffer {
  const id = String(spec.id || '').toLowerCase()
  if (!ID.test(id)) throw new Error(`Invalid provider id: ${String(spec.id)}`)
  const apiFormat = spec.apiFormat === 'claude' ? 'claude' : spec.apiFormat === undefined || spec.apiFormat === 'openai' ? 'openai' : null
  if (!apiFormat) throw new Error(`Invalid apiFormat: ${String(spec.apiFormat)}`)
  let url: URL
  try {
    url = new URL(String(spec.baseUrl || ''))
  } catch {
    throw new Error('provider baseUrl must be a URL')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('provider baseUrl must be https (or http on localhost)')
  }
  if (url.username || url.password) throw new Error('provider baseUrl must not carry credentials')
  const models = Array.isArray(spec.models) ? spec.models : []
  if (models.length === 0 || models.length > 32) throw new Error('provider needs 1–32 models')
  return {
    plugin,
    id,
    name: String(spec.name || id).slice(0, 80),
    apiFormat,
    baseUrl: url.toString().replace(/\/$/, ''),
    models: models.map((m) => {
      const o = (m || {}) as Record<string, unknown>
      const modelId = String(o.modelId || o.id || '').trim()
      if (!/^[A-Za-z0-9._:/@-]{1,128}$/.test(modelId)) throw new Error(`Invalid model id: ${modelId}`)
      const cw = Number(o.contextWindow)
      return {
        modelId,
        label: String(o.label || o.name || modelId).slice(0, 80),
        contextWindow: Number.isFinite(cw) && cw > 0 ? Math.floor(cw) : undefined,
        supportsTools: typeof o.supportsTools === 'boolean' ? o.supportsTools : undefined
      }
    })
  }
}

/**
 * The user clicked "Add" on an offer: create the provider disabled and without a
 * key, plus its models (disabled too). Returns the new provider id, or null when
 * a provider with the same base URL already exists.
 */
export function adoptProviderOffer(
  offer: ModProviderOffer,
  store: {
    providers: Array<{ baseUrl: string }>
    addProvider: (p: { id: string; name: string; apiFormat: 'openai' | 'claude'; baseUrl: string; enabled: boolean }) => { id: string }
    addModel: (m: {
      id: string
      providerId: string
      modelId: string
      label: string
      tier: 'mid'
      enabled: boolean
      contextWindow?: number
      supportsTools?: boolean
    }) => void
  }
): string | null {
  const norm = (u: string): string => u.replace(/\/+$/, '').toLowerCase()
  if (store.providers.some((p) => norm(p.baseUrl) === norm(offer.baseUrl))) return null
  const created = store.addProvider({
    id: '',
    name: `${offer.name} (mod ${offer.plugin})`,
    apiFormat: offer.apiFormat,
    baseUrl: offer.baseUrl,
    enabled: false
  })
  for (const m of offer.models) {
    store.addModel({
      id: '',
      providerId: created.id,
      modelId: m.modelId,
      label: m.label,
      tier: 'mid',
      enabled: false,
      contextWindow: m.contextWindow,
      supportsTools: m.supportsTools
    })
  }
  return created.id
}
