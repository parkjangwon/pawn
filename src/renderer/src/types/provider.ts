export type ApiFormat = 'openai' | 'claude'
export type AuthMethod = 'api-key' | 'oauth'
export type ModelTier = 'low' | 'mid' | 'high'

export interface Provider {
  id: string
  name: string
  apiFormat: ApiFormat
  authMethod: AuthMethod
  baseUrl: string
  apiKey?: string
  oauthToken?: string
  enabled: boolean
}

/**
 * Price per 1M tokens, in USD. `cacheRead` / `cacheWrite` are what make the
 * router's cost model meaningful: on a cached prefix Anthropic charges 0.1x for
 * reads and 1.25x for the initial write, so a model that looks expensive per
 * input token can be the cheapest option once the prefix is warm.
 */
export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface ModelEntry {
  id: string
  providerId: string
  modelId: string
  label: string
  tier: ModelTier
  enabled: boolean
  /** USD per 1M tokens. Absent means "unknown" — such models are never auto-selected on price. */
  pricing?: ModelPricing
  /** Max context window in tokens; drives compaction thresholds. */
  contextWindow?: number
  /** Whether the model can be given tool definitions. Non-tool models are only used for side tasks. */
  supportsTools?: boolean
}

export type RoutingMode = 'manual' | 'auto'

export interface ProviderConfig {
  providers: Provider[]
  models: ModelEntry[]
  routingMode: RoutingMode
  activeModelId: string | null
}

/**
 * Default pricing for well-known model ids, used to pre-fill both the manual
 * "add model" form and the provider presets below. Snapshot rates in USD per 1M
 * tokens — providers change pricing over time, so these are a starting point the
 * user can always override, not a live feed.
 */
export const KNOWN_PRICING: Record<string, ModelPricing & { tier: ModelTier; contextWindow: number }> = {
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, tier: 'high', contextWindow: 200_000 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tier: 'mid', contextWindow: 200_000 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, tier: 'low', contextWindow: 200_000 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1, tier: 'low', contextWindow: 200_000 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5, tier: 'mid', contextWindow: 128_000 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15, tier: 'low', contextWindow: 128_000 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2, tier: 'high', contextWindow: 1_000_000 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4, tier: 'mid', contextWindow: 1_000_000 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1, tier: 'low', contextWindow: 1_000_000 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1, tier: 'high', contextWindow: 200_000 },

  'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27, tier: 'mid', contextWindow: 64_000 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55, tier: 'high', contextWindow: 64_000 },

  'moonshot-v1-8k': { input: 0.2, output: 2, cacheRead: 0.02, cacheWrite: 0.2, tier: 'low', contextWindow: 8_000 },
  'moonshot-v1-32k': { input: 0.4, output: 4, cacheRead: 0.04, cacheWrite: 0.4, tier: 'mid', contextWindow: 32_000 },
  'moonshot-v1-128k': { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1, tier: 'high', contextWindow: 128_000 },
  'kimi-k2': { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0.6, tier: 'mid', contextWindow: 128_000 },

  'qwen-turbo': { input: 0.05, output: 0.2, cacheRead: 0.02, cacheWrite: 0.05, tier: 'low', contextWindow: 131_072 },
  'qwen-plus': { input: 0.4, output: 1.2, cacheRead: 0.08, cacheWrite: 0.4, tier: 'mid', contextWindow: 131_072 },
  'qwen-max': { input: 1.6, output: 6.4, cacheRead: 0.32, cacheWrite: 1.6, tier: 'high', contextWindow: 32_768 },

  'llama-3.1-8b': { input: 0.05, output: 0.08, cacheRead: 0.05, cacheWrite: 0.05, tier: 'low', contextWindow: 131_072 },
  'llama-3.3-70b': { input: 0.59, output: 0.79, cacheRead: 0.59, cacheWrite: 0.59, tier: 'mid', contextWindow: 131_072 },
  'mixtral-8x7b': { input: 0.24, output: 0.24, cacheRead: 0.24, cacheWrite: 0.24, tier: 'mid', contextWindow: 32_768 },

  'mistral-large': { input: 2, output: 6, cacheRead: 2, cacheWrite: 2, tier: 'high', contextWindow: 131_072 },
  'mistral-small': { input: 0.1, output: 0.3, cacheRead: 0.1, cacheWrite: 0.1, tier: 'low', contextWindow: 131_072 },

  'grok-3': { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 3, tier: 'high', contextWindow: 131_072 },
  'grok-3-mini': { input: 0.3, output: 0.5, cacheRead: 0.075, cacheWrite: 0.3, tier: 'low', contextWindow: 131_072 },

  'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1, tier: 'low', contextWindow: 1_000_000 },
  'gemini-1.5-pro': { input: 1.25, output: 5, cacheRead: 0.3125, cacheWrite: 1.25, tier: 'high', contextWindow: 2_000_000 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0.075, tier: 'low', contextWindow: 1_000_000 },

  sonar: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, tier: 'mid', contextWindow: 127_000 },
  'sonar-pro': { input: 3, output: 15, cacheRead: 3, cacheWrite: 3, tier: 'high', contextWindow: 200_000 }
}

/** Best-effort pricing lookup by longest known-id prefix match. */
export function guessPricing(modelId: string): (ModelPricing & { tier: ModelTier; contextWindow: number }) | null {
  const id = modelId.toLowerCase()
  let best: string | null = null
  for (const key of Object.keys(KNOWN_PRICING)) {
    if (id.includes(key) && (best === null || key.length > best.length)) best = key
  }
  return best ? KNOWN_PRICING[best] : null
}
