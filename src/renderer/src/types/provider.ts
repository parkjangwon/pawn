export type ApiFormat = 'openai' | 'claude'
export type ModelTier = 'low' | 'mid' | 'high'

export interface Provider {
  id: string
  name: string
  apiFormat: ApiFormat
  baseUrl: string
  apiKey?: string
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
  /**
   * Whether the model accepts image / vision inputs.
   * - true: safe for image turns
   * - false: never send images (router falls back)
   * - undefined: unknown — try once, then fall back on a vision capability error
   */
  supportsVision?: boolean
}

export type RoutingMode = 'manual' | 'auto'

export interface ProviderConfig {
  providers: Provider[]
  models: ModelEntry[]
  routingMode: RoutingMode
  activeModelId: string | null
  /**
   * Optional preferred model for image turns when the active/auto pick cannot
   * see. Null means "any vision-capable model".
   */
  visionModelId?: string | null
}

/**
 * Default pricing for well-known model ids, used to pre-fill both the manual
 * "add model" form and the provider presets below. Snapshot rates in USD per 1M
 * tokens — providers change pricing over time, so these are a starting point the
 * user can always override, not a live feed.
 */
export const KNOWN_PRICING: Record<string, ModelPricing & { tier: ModelTier; contextWindow: number }> = {
  // --- Anthropic (https://platform.claude.com/docs/en/about-claude/models/overview, 2026-08) ---
  // Longer keys first for longest-prefix match (fable before opus, etc.).
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tier: 'high', contextWindow: 1_000_000 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, tier: 'high', contextWindow: 1_000_000 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tier: 'mid', contextWindow: 1_000_000 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, tier: 'low', contextWindow: 200_000 },
  // Legacy Anthropic ids (still hydrate older configs)
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, tier: 'high', contextWindow: 1_000_000 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, tier: 'high', contextWindow: 200_000 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, tier: 'high', contextWindow: 200_000 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tier: 'mid', contextWindow: 1_000_000 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tier: 'mid', contextWindow: 200_000 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tier: 'mid', contextWindow: 200_000 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1, tier: 'low', contextWindow: 200_000 },

  // --- OpenAI (https://developers.openai.com/api/docs/models, 2026-08) ---
  'gpt-5.6-sol': { input: 5, output: 30, cacheRead: 1.25, cacheWrite: 5, tier: 'high', contextWindow: 1_050_000 },
  'gpt-5.6-terra': { input: 2, output: 12, cacheRead: 0.5, cacheWrite: 2, tier: 'mid', contextWindow: 1_050_000 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.05, cacheWrite: 0.2, tier: 'low', contextWindow: 1_050_000 },
  'gpt-5.5': { input: 2.5, output: 15, cacheRead: 0.625, cacheWrite: 2.5, tier: 'high', contextWindow: 1_000_000 },
  'gpt-5.4': { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 2, tier: 'high', contextWindow: 1_000_000 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25, tier: 'high', contextWindow: 400_000 },
  // Legacy OpenAI ids
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15, tier: 'low', contextWindow: 128_000 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5, tier: 'mid', contextWindow: 128_000 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4, tier: 'mid', contextWindow: 1_000_000 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1, tier: 'low', contextWindow: 1_000_000 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2, tier: 'high', contextWindow: 1_000_000 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1, tier: 'high', contextWindow: 200_000 },

  // --- DeepSeek V4 (https://api-docs.deepseek.com/quick_start/pricing/, 2026-08) ---
  // Disk context cache: hit ≪ miss (≈50× Flash). cacheWrite unused (auto disk cache).
  // Max output 384K; context 1M. Tool calls + thinking supported on both.
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14, tier: 'mid', contextWindow: 1_000_000 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0.435, tier: 'high', contextWindow: 1_000_000 },
  'deepseek-v3': { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27, tier: 'mid', contextWindow: 128_000 },
  // Legacy aliases (retired ~2026-07-24; map to Flash economics for hydrate)
  'deepseek-chat': { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14, tier: 'mid', contextWindow: 1_000_000 },
  'deepseek-reasoner': { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14, tier: 'high', contextWindow: 1_000_000 },

  // --- Xiaomi MiMo (https://mimo.mi.com/docs — V2.5 series; Go pricing mirror) ---
  'mimo-v2.5-pro': { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0.435, tier: 'high', contextWindow: 1_000_000 },
  'mimo-v2.5': { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0.14, tier: 'mid', contextWindow: 1_000_000 },

  // --- Open-coding peers (OpenCode Go table, 2026-08) ---
  'glm-5.2': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4, tier: 'high', contextWindow: 200_000 },
  'glm-5.1': { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4, tier: 'high', contextWindow: 200_000 },
  'kimi-k3': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3, tier: 'high', contextWindow: 1_000_000 },
  'kimi-k2.7': { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0.95, tier: 'mid', contextWindow: 256_000 },
  'kimi-k2.6': { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0.95, tier: 'mid', contextWindow: 256_000 },
  'minimax-m3': { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.3, tier: 'mid', contextWindow: 200_000 },
  'minimax-m2.7': { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375, tier: 'mid', contextWindow: 200_000 },
  'qwen3.8-max': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5, tier: 'high', contextWindow: 256_000 },
  'qwen3.7-max': { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125, tier: 'high', contextWindow: 256_000 },
  'qwen3.7-plus': { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5, tier: 'mid', contextWindow: 256_000 },
  'qwen3.6-plus': { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625, tier: 'mid', contextWindow: 256_000 },
  hy3: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0.14, tier: 'mid', contextWindow: 200_000 },

  // --- Moonshot / Kimi ---
  'moonshot-v1-8k': { input: 0.2, output: 2, cacheRead: 0.02, cacheWrite: 0.2, tier: 'low', contextWindow: 8_000 },
  'moonshot-v1-32k': { input: 0.4, output: 4, cacheRead: 0.04, cacheWrite: 0.4, tier: 'mid', contextWindow: 32_000 },
  'moonshot-v1-128k': { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1, tier: 'high', contextWindow: 128_000 },
  'kimi-k2': { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0.6, tier: 'mid', contextWindow: 128_000 },

  // --- Alibaba Qwen ---
  'qwen-turbo': { input: 0.05, output: 0.2, cacheRead: 0.02, cacheWrite: 0.05, tier: 'low', contextWindow: 1_000_000 },
  'qwen-plus': { input: 0.4, output: 1.2, cacheRead: 0.08, cacheWrite: 0.4, tier: 'mid', contextWindow: 1_000_000 },
  'qwen-max': { input: 1.6, output: 6.4, cacheRead: 0.32, cacheWrite: 1.6, tier: 'high', contextWindow: 262_144 },
  'qwen3': { input: 0.4, output: 1.2, cacheRead: 0.08, cacheWrite: 0.4, tier: 'mid', contextWindow: 131_072 },

  // --- Meta / open weights (via Groq, Together, etc.) ---
  'llama-3.1-8b': { input: 0.05, output: 0.08, cacheRead: 0.05, cacheWrite: 0.05, tier: 'low', contextWindow: 131_072 },
  'llama-3.3-70b': { input: 0.59, output: 0.79, cacheRead: 0.59, cacheWrite: 0.59, tier: 'mid', contextWindow: 131_072 },
  'llama-4': { input: 0.2, output: 0.6, cacheRead: 0.2, cacheWrite: 0.2, tier: 'mid', contextWindow: 256_000 },
  'mixtral-8x7b': { input: 0.24, output: 0.24, cacheRead: 0.24, cacheWrite: 0.24, tier: 'mid', contextWindow: 32_768 },

  // --- Mistral ---
  'mistral-large': { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2, tier: 'high', contextWindow: 256_000 },
  'mistral-medium': { input: 0.4, output: 2, cacheRead: 0.1, cacheWrite: 0.4, tier: 'mid', contextWindow: 128_000 },
  'mistral-small': { input: 0.1, output: 0.3, cacheRead: 0.025, cacheWrite: 0.1, tier: 'low', contextWindow: 128_000 },
  codestral: { input: 0.3, output: 0.9, cacheRead: 0.075, cacheWrite: 0.3, tier: 'mid', contextWindow: 256_000 },

  // --- xAI Grok (https://docs.x.ai/developers/models, 2026-08; ≤200k band) ---
  'grok-4.5': { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 2, tier: 'high', contextWindow: 500_000 },
  'grok-4.3': { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 1.25, tier: 'mid', contextWindow: 1_000_000 },
  'grok-4.20': { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 1.25, tier: 'mid', contextWindow: 1_000_000 },
  'grok-build': { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 1, tier: 'mid', contextWindow: 256_000 },
  'grok-3-mini': { input: 0.3, output: 0.5, cacheRead: 0.075, cacheWrite: 0.3, tier: 'low', contextWindow: 131_072 },
  'grok-3': { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 3, tier: 'high', contextWindow: 131_072 },

  // --- Gemini (https://ai.google.dev/gemini-api/docs/pricing, 2026-08) ---
  'gemini-3.1-pro-preview': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2, tier: 'high', contextWindow: 1_048_576 },
  'gemini-3.1-pro': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2, tier: 'high', contextWindow: 1_048_576 },
  'gemini-3.6-flash': { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.5, tier: 'mid', contextWindow: 1_048_576 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3, tier: 'low', contextWindow: 1_048_576 },
  'gemini-3.5-flash': { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 1.5, tier: 'mid', contextWindow: 1_048_576 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.25, tier: 'low', contextWindow: 1_048_576 },
  'gemini-3-flash-preview': { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.5, tier: 'mid', contextWindow: 1_048_576 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25, tier: 'high', contextWindow: 1_048_576 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.1, tier: 'low', contextWindow: 1_048_576 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3, tier: 'mid', contextWindow: 1_048_576 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1, tier: 'low', contextWindow: 1_000_000 },
  'gemini-1.5-pro': { input: 1.25, output: 5, cacheRead: 0.3125, cacheWrite: 1.25, tier: 'high', contextWindow: 2_000_000 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0.075, tier: 'low', contextWindow: 1_000_000 },

  // --- Perplexity ---
  'sonar-reasoning': { input: 1, output: 5, cacheRead: 1, cacheWrite: 1, tier: 'high', contextWindow: 127_000 },
  'sonar-pro': { input: 3, output: 15, cacheRead: 3, cacheWrite: 3, tier: 'high', contextWindow: 200_000 },
  sonar: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, tier: 'mid', contextWindow: 127_000 }
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

/**
 * Best-effort vision capability guess from the model id. Returns undefined when
 * we do not know — the router will try the model once on image turns.
 */
export function guessSupportsVision(modelId: string): boolean | undefined {
  const id = modelId.toLowerCase()

  // Explicit non-vision families first (substring order matters vs generic names).
  const noVision = [
    'deepseek-v4', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-r1', 'deepseek',
    'mimo-v2.5-pro', // text + tools + thinking; omni is mimo-v2.5 without -pro
    'llama-3.1', 'llama-3.3', 'llama3.3', 'llama3.1', 'llama-3',
    'mixtral', 'qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen2.5', 'qwen3',
    'codestral', 'ministral', 'sonar-reasoning', 'sonar-pro', 'sonar',
    'glm-5', 'kimi-k', 'minimax', 'hy3'
  ]
  for (const key of noVision) {
    if (id.includes(key)) return false
  }

  // Known multimodal / vision families.
  const yesVision = [
    'gpt-5.6', 'gpt-5.5', 'gpt-5.4', 'gpt-5', 'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-4-vision',
    'o4-mini', 'o3',
    'claude-fable', 'claude-opus', 'claude-sonnet', 'claude-haiku', 'claude-3', 'claude-4', 'claude-5',
    'gemini',
    'grok-4.5', 'grok-4.3', 'grok-4', 'grok-3',
    'mimo-v2.5', // full-modal (image/audio/video); checked after mimo-v2.5-pro above
    'qwen-vl', 'qwen2-vl', 'llava', 'vision',
    'mistral-large', 'mistral-medium', 'mistral-small', 'pixtral'
  ]
  for (const key of yesVision) {
    if (id.includes(key)) return true
  }

  return undefined
}
