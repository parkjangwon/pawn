/**
 * Decision models ("System One"): typed, calibrated answers (choice / score /
 * yes-no) in one forward pass instead of generated text. TypeSafe's hosted Jev
 * is the first-party provider; Ollaya serves open models locally on the same
 * wire format (`POST /v1/systemone`, `GET /v1/models`).
 *
 * Pure types + constants: shared by the Electron main process and the
 * headless runner (no electron imports here).
 */

export type DecisionProviderKind = 'typesafe' | 'ollaya' | 'custom'

/** Harness integration points that may call the active decision provider. */
export interface DecisionFeatures {
  /** Expose the `decide` tool to the agent. */
  agentTool: boolean
  /** Rate shell commands before running; re-ask for destructive ones. */
  shellRiskGuard: boolean
  /** Auto routing: classify each new turn's complexity with the decision model. */
  routerAssist: boolean
}

export type DecisionPurpose = 'tool' | 'shell_risk' | 'routing' | 'test'

export interface DecisionProviderConfig {
  id: string
  kind: DecisionProviderKind
  name: string
  /** API root without `/v1` (the SDK appends `/v1/systemone`). */
  baseUrl: string
  /** Plaintext in memory; the store encrypts it at rest. */
  apiKey?: string
  /** Model sent in every request (e.g. `jev-latest`, `laya`, `winnow:e4b`). */
  model: string
  /** At most one provider is enabled (the active one). */
  enabled: boolean
}

export interface DecisionConfig {
  version: 1
  providers: DecisionProviderConfig[]
  features: DecisionFeatures
}

/** Provider as shown to the renderer — never carries the key. */
export interface DecisionProviderView {
  id: string
  kind: DecisionProviderKind
  name: string
  baseUrl: string
  model: string
  enabled: boolean
  hasKey: boolean
  /** Last 4 characters of the key, for recognition only. */
  keyHint?: string
  /** Loopback / private host: decisions never leave this machine or LAN. */
  local: boolean
}

export interface DecisionStatus {
  providers: DecisionProviderView[]
  features: DecisionFeatures
  active: DecisionProviderView | null
}

export interface DecisionModelInfo {
  name: string
  description?: string
  releaseDate?: string
}

/** Normalized question (TypeSafe wire shape). */
export type DecisionQuestion =
  | { type: 'noul'; instructions?: unknown; criteria?: { true?: unknown; false?: unknown } | null }
  | { type: 'choice'; instructions?: unknown; criteria: Record<string, unknown> }
  | { type: 'score'; instructions?: unknown; criteria: unknown[] }

export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | {
      type: 'score'
      score: number
      confidence: number
      legend: Record<string, unknown>
      probabilities: Record<string, number>
    }

export interface DecideRequest {
  state: unknown
  questions: Record<string, DecisionQuestion>
  model?: string
}

export type DecideResult =
  | {
      ok: true
      /** Versioned model that answered (may differ from the alias sent). */
      model: string
      answers: Record<string, DecisionAnswer>
      usage?: { input_tokens?: number; output_tokens?: number }
      latencyMs: number
      provider: { id: string; name: string; kind: DecisionProviderKind; local: boolean }
    }
  | { ok: false; error: string; code?: string; status?: number }

export interface DecisionPreset {
  kind: DecisionProviderKind
  name: string
  baseUrl: string
  model: string
  keyRequired: boolean
  consoleUrl?: string
  docsUrl: string
}

export const DECISION_PRESETS: Record<DecisionProviderKind, DecisionPreset> = {
  typesafe: {
    kind: 'typesafe',
    name: 'TypeSafe',
    baseUrl: 'https://api.typesafe.ai',
    model: 'jev-latest',
    keyRequired: true,
    consoleUrl: 'https://console.typesafe.ai',
    docsUrl: 'https://docs.typesafe.ai'
  },
  ollaya: {
    kind: 'ollaya',
    name: 'Ollaya',
    baseUrl: 'http://localhost:11435',
    model: 'laya',
    keyRequired: false,
    docsUrl: 'https://ollaya.dev/docs'
  },
  custom: {
    kind: 'custom',
    name: 'Custom',
    baseUrl: '',
    model: '',
    keyRequired: false,
    docsUrl: 'https://docs.typesafe.ai/api'
  }
}

export const DEFAULT_DECISION_FEATURES: DecisionFeatures = {
  agentTool: true,
  shellRiskGuard: true,
  // Changes which chat model answers; opt-in.
  routerAssist: false
}

export function emptyDecisionConfig(): DecisionConfig {
  return { version: 1, providers: [], features: { ...DEFAULT_DECISION_FEATURES } }
}

/** Limits enforced before anything leaves the machine. */
export const DECISION_LIMITS = {
  maxQuestions: 128,
  maxChoiceOptions: 255,
  minChoiceOptions: 2,
  minScoreLevels: 2,
  maxScoreLevels: 10,
  /** Serialized state + questions (chars). Hosted Jev reads 64k tokens. */
  maxPayloadChars: 200_000,
  minTimeoutMs: 300,
  maxTimeoutMs: 60_000
} as const
