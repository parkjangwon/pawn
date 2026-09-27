/**
 * Decision-model service: provider registry, validation, and calls through the
 * official TypeSafe SDK (`@typesafe-ai/sdk`). Ollaya and any other
 * TypeSafe-compatible server use the same client with a different base URL.
 *
 * Runs in the Electron main process (keys never reach the renderer) and in
 * the headless runner. No electron imports: persistence is injected.
 */

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
  TypeSafeError,
  type TypeSafeClientConfig
} from '@typesafe-ai/sdk'
import { redactDeep } from './redact'
import {
  DECISION_LIMITS,
  DECISION_PRESETS,
  emptyDecisionConfig,
  DEFAULT_DECISION_FEATURES,
  type DecideRequest,
  type DecideResult,
  type DecisionAnswer,
  type DecisionConfig,
  type DecisionFeatures,
  type DecisionModelInfo,
  type DecisionProviderConfig,
  type DecisionProviderKind,
  type DecisionProviderView,
  type DecisionPurpose,
  type DecisionQuestion,
  type DecisionStatus
} from './types'

export interface DecisionStore {
  /** Config with plaintext keys. */
  load(): DecisionConfig
  save(cfg: DecisionConfig): void
}

/** The slice of TypeSafeClient the service uses (swappable in tests). */
export interface DecisionClient {
  systemOne(
    request: { state: unknown; questions: Record<string, unknown>; model?: string },
    options?: { timeout?: number; retry?: { maxRetries?: number }; signal?: AbortSignal }
  ): PromiseLike<{ model: string; answers: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number } }>
  models: {
    list(options?: { timeout?: number; retry?: { maxRetries?: number } }): PromiseLike<
      ReadonlyArray<{ name: string; description?: string; release_date?: string }>
    >
  }
}

export interface DecisionServiceDeps {
  store: DecisionStore
  createClient?: (config: TypeSafeClientConfig) => DecisionClient
  now?: () => number
}

export type DecisionService = ReturnType<typeof createDecisionService>

const KINDS: DecisionProviderKind[] = ['typesafe', 'ollaya', 'custom']
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/
const MODEL_RE = /^[A-Za-z0-9_.:/@+-]{1,128}$/

// --- URL helpers ------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return ''
  }
}

/** Loopback, private-range, or mDNS host: traffic stays on this machine / LAN. */
export function isLocalBaseUrl(url: string): boolean {
  const h = hostOf(url)
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return /^f[cd][0-9a-f]{2}:/i.test(h) // IPv6 ULA
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/**
 * Normalize an API root: trims, drops trailing slashes and a trailing `/v1`
 * (the SDK appends `/v1/systemone`). Plain http is allowed only for local
 * hosts so a key never crosses the internet unencrypted.
 */
export function normalizeBaseUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { ok: false, error: 'Base URL is required' }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { ok: false, error: `Invalid base URL: ${s}` }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Base URL must use http or https' }
  if (u.username || u.password) return { ok: false, error: 'Put credentials in the API key field, not the URL' }
  if (u.protocol === 'http:' && !isLocalBaseUrl(s)) {
    return { ok: false, error: 'Use https for remote hosts (plain http is only allowed for localhost / private network)' }
  }
  u.search = ''
  u.hash = ''
  const url = u.toString().replace(/\/+$/, '').replace(/\/v1$/i, '')
  return { ok: true, url }
}

// --- Question validation ----------------------------------------------------

function isEntry(v: unknown): boolean {
  return v === null || v === undefined || typeof v === 'string' || typeof v === 'object'
}

/**
 * Validate and normalize questions into TypeSafe's wire shape. Accepts choice
 * criteria as an object (label → description) or an array of labels.
 */
export function normalizeQuestions(
  raw: unknown
): { ok: true; questions: Record<string, DecisionQuestion> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'questions must be an object' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length === 0) return { ok: false, error: 'At least one question is required' }
  if (entries.length > DECISION_LIMITS.maxQuestions) {
    return { ok: false, error: `Too many questions (${entries.length} > ${DECISION_LIMITS.maxQuestions})` }
  }
  const out: Record<string, DecisionQuestion> = {}
  for (const [id, q] of entries) {
    if (!ID_RE.test(id)) return { ok: false, error: `Invalid question id "${id}" (letters, digits, _ . : - only)` }
    if (!q || typeof q !== 'object') return { ok: false, error: `Question "${id}" must be an object` }
    const o = q as Record<string, unknown>
    const instructions = o.instructions
    if (!isEntry(instructions)) return { ok: false, error: `Question "${id}": instructions must be text or JSON` }
    const base = instructions === undefined || instructions === null || instructions === '' ? {} : { instructions }
    switch (o.type) {
      case 'noul': {
        const c = o.criteria
        let criteria: { true?: unknown; false?: unknown } | undefined
        if (c && typeof c === 'object' && !Array.isArray(c)) {
          const cc = c as Record<string, unknown>
          criteria = {}
          if (cc.true !== undefined && cc.true !== null && cc.true !== '') criteria.true = cc.true
          if (cc.false !== undefined && cc.false !== null && cc.false !== '') criteria.false = cc.false
          if (!Object.keys(criteria).length) criteria = undefined
        }
        out[id] = { type: 'noul', ...base, ...(criteria ? { criteria } : {}) }
        break
      }
      case 'choice': {
        let criteria: Record<string, unknown> = {}
        if (Array.isArray(o.criteria)) {
          for (const label of o.criteria) {
            const l = String(label ?? '').trim()
            if (l) criteria[l] = null
          }
        } else if (o.criteria && typeof o.criteria === 'object') {
          for (const [label, desc] of Object.entries(o.criteria as Record<string, unknown>)) {
            const l = label.trim()
            if (!l) continue
            if (!isEntry(desc)) return { ok: false, error: `Question "${id}": option "${l}" description must be text or JSON` }
            criteria[l] = desc === undefined || desc === '' ? null : desc
          }
        } else {
          return { ok: false, error: `Question "${id}": choice needs criteria (options)` }
        }
        const n = Object.keys(criteria).length
        if (n < DECISION_LIMITS.minChoiceOptions || n > DECISION_LIMITS.maxChoiceOptions) {
          return {
            ok: false,
            error: `Question "${id}": choice needs ${DECISION_LIMITS.minChoiceOptions}–${DECISION_LIMITS.maxChoiceOptions} options (got ${n})`
          }
        }
        out[id] = { type: 'choice', ...base, criteria }
        break
      }
      case 'score': {
        if (!Array.isArray(o.criteria)) return { ok: false, error: `Question "${id}": score criteria must be an array of levels` }
        const levels = o.criteria.map((l) => (l === undefined || l === '' ? null : l))
        if (!levels.every(isEntry)) return { ok: false, error: `Question "${id}": score levels must be text or JSON` }
        if (levels.length < DECISION_LIMITS.minScoreLevels || levels.length > DECISION_LIMITS.maxScoreLevels) {
          return {
            ok: false,
            error: `Question "${id}": score needs ${DECISION_LIMITS.minScoreLevels}–${DECISION_LIMITS.maxScoreLevels} levels (got ${levels.length})`
          }
        }
        out[id] = { type: 'score', ...base, criteria: levels }
        break
      }
      default:
        return { ok: false, error: `Question "${id}": type must be choice, score or noul` }
    }
  }
  return { ok: true, questions: out }
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (v && typeof v === 'object') {
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) out[k] = num(p)
  }
  return out
}

/** Coerce a wire answer into a stable shape (tolerates missing fields). */
export function normalizeAnswer(raw: unknown): DecisionAnswer | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (a.type === 'noul' || (a.type === undefined && 'noul' in a)) return { type: 'noul', noul: num(a.noul) }
  if (a.type === 'choice' || (a.type === undefined && 'choice' in a)) {
    return { type: 'choice', choice: String(a.choice ?? ''), confidence: num(a.confidence), probabilities: numMap(a.probabilities) }
  }
  if (a.type === 'score' || (a.type === undefined && 'score' in a)) {
    return {
      type: 'score',
      score: num(a.score),
      confidence: num(a.confidence),
      legend: a.legend && typeof a.legend === 'object' ? (a.legend as Record<string, unknown>) : {},
      probabilities: numMap(a.probabilities)
    }
  }
  return null
}

// --- Errors -----------------------------------------------------------------

/**
 * Human message from an error body. Shapes seen in the wild:
 *   TypeSafe: {"detail": {"error_type": "...", "message": "..."}}
 *   FastAPI 422: {"detail": [{"loc": [...], "msg": "..."}]}
 *   Ollaya: {"error": "...", "code": "..."}
 */
function errorBodyMessage(body: unknown): string {
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return ''
  const b = body as Record<string, unknown>
  if (typeof b.error === 'string') return b.error
  if (b.error && typeof b.error === 'object' && typeof (b.error as Record<string, unknown>).message === 'string') {
    return String((b.error as Record<string, unknown>).message)
  }
  const d = b.detail
  if (typeof d === 'string') return d
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof (d as Record<string, unknown>).message === 'string') {
    return String((d as Record<string, unknown>).message)
  }
  if (Array.isArray(d)) {
    return d
      .slice(0, 3)
      .map((x) => {
        const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
        const loc = Array.isArray(o.loc) ? o.loc.filter((p) => p !== 'body').join('.') : ''
        return `${loc ? `${loc}: ` : ''}${String(o.msg ?? '')}`
      })
      .filter(Boolean)
      .join('; ')
  }
  if (typeof b.message === 'string') return b.message
  return ''
}

function describeError(err: unknown, provider: DecisionProviderConfig): { error: string; code?: string; status?: number } {
  const where = provider.kind === 'ollaya' ? `Ollaya at ${provider.baseUrl}` : `${provider.name} (${provider.baseUrl})`
  if (err instanceof APIUserAbortError) return { error: 'Cancelled', code: 'aborted' }
  if (err instanceof APITimeoutError) return { error: `Timed out waiting for ${where}`, code: 'timeout' }
  if (err instanceof APIConnectionError) {
    const hint = provider.kind === 'ollaya' ? ' — is `ollaya serve` (or the Ollaya app) running?' : ''
    return { error: `Could not reach ${where}${hint}`, code: 'connection' }
  }
  if (err instanceof APIError) {
    const body = err.body as Record<string, unknown> | string | undefined
    const bodyMsg = errorBodyMessage(body)
    const code =
      body && typeof body === 'object'
        ? typeof body.code === 'string'
          ? body.code
          : typeof (body.detail as Record<string, unknown> | undefined)?.error_type === 'string'
            ? String((body.detail as Record<string, unknown>).error_type)
            : undefined
        : undefined
    let msg = bodyMsg || err.message
    if (err.status === 401 || code === 'authentication_error') msg = `Invalid or missing API key for ${provider.name}`
    else if (code === 'MODEL_NOT_FOUND' && provider.kind === 'ollaya') msg = `${msg} (run \`ollaya pull ${provider.model}\`)`
    return { error: msg.slice(0, 500), code: code ?? `http_${err.status}`, status: err.status }
  }
  if (err instanceof TypeSafeError) return { error: err.message, code: 'sdk' }
  return { error: err instanceof Error ? err.message : String(err) }
}

// --- Service ----------------------------------------------------------------

function keyHint(key: string | undefined): string | undefined {
  if (!key) return undefined
  return key.length > 8 ? `…${key.slice(-4)}` : '…'
}

function toView(p: DecisionProviderConfig): DecisionProviderView {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    enabled: p.enabled,
    hasKey: !!p.apiKey,
    keyHint: keyHint(p.apiKey),
    local: isLocalBaseUrl(p.baseUrl)
  }
}

function sanitizeConfig(raw: unknown): DecisionConfig {
  const cfg = emptyDecisionConfig()
  if (!raw || typeof raw !== 'object') return cfg
  const r = raw as Record<string, unknown>
  const f = (r.features && typeof r.features === 'object' ? r.features : {}) as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_DECISION_FEATURES) as (keyof DecisionFeatures)[]) {
    if (typeof f[k] === 'boolean') cfg.features[k] = f[k] as boolean
  }
  let seenEnabled = false
  for (const p of Array.isArray(r.providers) ? r.providers : []) {
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const kind = KINDS.includes(o.kind as DecisionProviderKind) ? (o.kind as DecisionProviderKind) : 'custom'
    const base = normalizeBaseUrl(o.baseUrl)
    if (!base.ok || typeof o.id !== 'string' || !ID_RE.test(o.id)) continue
    const enabled = o.enabled === true && !seenEnabled
    if (enabled) seenEnabled = true
    cfg.providers.push({
      id: o.id,
      kind,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : DECISION_PRESETS[kind].name,
      baseUrl: base.url,
      apiKey: typeof o.apiKey === 'string' && o.apiKey ? o.apiKey : undefined,
      model: typeof o.model === 'string' && MODEL_RE.test(o.model) ? o.model : DECISION_PRESETS[kind].model,
      enabled
    })
  }
  return cfg
}

export function createDecisionService(deps: DecisionServiceDeps) {
  const now = deps.now ?? (() => Date.now())
  const makeClient =
    deps.createClient ?? ((config: TypeSafeClientConfig): DecisionClient => new TypeSafeClient(config) as unknown as DecisionClient)
  const clients = new Map<string, { fp: string; client: DecisionClient }>()

  const load = (): DecisionConfig => {
    try {
      return sanitizeConfig(deps.store.load())
    } catch {
      return emptyDecisionConfig()
    }
  }
  const save = (cfg: DecisionConfig): void => deps.store.save(cfg)

  function clientFor(p: DecisionProviderConfig): DecisionClient {
    // The SDK requires a non-empty key; Ollaya accepts any value unless OLLAYA_API_KEY is set.
    const apiKey = p.apiKey || 'local'
    const fp = `${p.baseUrl}\n${apiKey}\n${p.model}`
    const hit = clients.get(p.id)
    if (hit && hit.fp === fp) return hit.client
    const client = makeClient({
      apiKey,
      baseURL: p.baseUrl,
      defaultModel: p.model || DECISION_PRESETS[p.kind].model || 'jev-latest',
      // Request bodies may hold user data: never log them.
      logLevel: 'off',
      timeout: 15_000,
      defaultHeaders: { 'X-Pawn-Client': 'pawn' }
    })
    clients.set(p.id, { fp, client })
    return client
  }

  function status(): DecisionStatus {
    const cfg = load()
    const providers = cfg.providers.map(toView)
    return { providers, features: cfg.features, active: providers.find((p) => p.enabled) ?? null }
  }

  function active(): DecisionProviderConfig | null {
    return load().providers.find((p) => p.enabled) ?? null
  }

  /**
   * Add or update a provider. `apiKey: undefined` keeps the stored key,
   * `''` clears it. The first provider added becomes active.
   */
  function saveProvider(input: unknown): { ok: true; id: string; status: DecisionStatus } | { ok: false; error: string } {
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid provider' }
    const o = input as Record<string, unknown>
    const cfg = load()
    const existing = typeof o.id === 'string' ? cfg.providers.find((p) => p.id === o.id) : undefined
    const kind: DecisionProviderKind = KINDS.includes(o.kind as DecisionProviderKind)
      ? (o.kind as DecisionProviderKind)
      : (existing?.kind ?? 'custom')
    const preset = DECISION_PRESETS[kind]
    const base = normalizeBaseUrl(o.baseUrl ?? existing?.baseUrl ?? preset.baseUrl)
    if (!base.ok) return base
    const modelRaw = typeof o.model === 'string' ? o.model.trim() : (existing?.model ?? preset.model)
    const model = modelRaw || preset.model
    if (!model) return { ok: false, error: 'Model is required' }
    if (!MODEL_RE.test(model)) return { ok: false, error: `Invalid model name: ${model}` }
    const apiKey =
      o.apiKey === undefined ? existing?.apiKey : typeof o.apiKey === 'string' && o.apiKey.trim() ? o.apiKey.trim() : undefined
    if (preset.keyRequired && !apiKey && !isLocalBaseUrl(base.url)) return { ok: false, error: `${preset.name} needs an API key` }
    if (apiKey && /\s/.test(apiKey)) return { ok: false, error: 'API key must not contain spaces' }
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : (existing?.name ?? preset.name)

    const next: DecisionProviderConfig = {
      id: existing?.id ?? `dp-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      name,
      baseUrl: base.url,
      apiKey,
      model,
      enabled: existing ? existing.enabled : !cfg.providers.some((p) => p.enabled)
    }
    cfg.providers = existing ? cfg.providers.map((p) => (p.id === next.id ? next : p)) : [...cfg.providers, next]
    save(cfg)
    clients.delete(next.id)
    return { ok: true, id: next.id, status: status() }
  }

  function removeProvider(id: unknown): { ok: boolean; error?: string; status?: DecisionStatus } {
    const cfg = load()
    if (!cfg.providers.some((p) => p.id === id)) return { ok: false, error: 'Unknown provider' }
    cfg.providers = cfg.providers.filter((p) => p.id !== id)
    save(cfg)
    clients.delete(String(id))
    return { ok: true, status: status() }
  }

  /** Enabling one provider disables the others (one active provider). */
  function setEnabled(id: unknown, enabled: unknown): { ok: boolean; error?: string; status?: DecisionStatus } {
    const cfg = load()
    if (!cfg.providers.some((p) => p.id === id)) return { ok: false, error: 'Unknown provider' }
    const on = enabled === true
    cfg.providers = cfg.providers.map((p) => ({ ...p, enabled: p.id === id ? on : on ? false : p.enabled }))
    save(cfg)
    return { ok: true, status: status() }
  }

  function setFeatures(partial: unknown): { ok: boolean; status: DecisionStatus } {
    const cfg = load()
    if (partial && typeof partial === 'object') {
      for (const k of Object.keys(DEFAULT_DECISION_FEATURES) as (keyof DecisionFeatures)[]) {
        const v = (partial as Record<string, unknown>)[k]
        if (typeof v === 'boolean') cfg.features[k] = v
      }
      save(cfg)
    }
    return { ok: true, status: status() }
  }

  async function listModels(id: unknown): Promise<{ ok: true; models: DecisionModelInfo[] } | { ok: false; error: string; code?: string }> {
    const p = load().providers.find((x) => x.id === id)
    if (!p) return { ok: false, error: 'Unknown provider' }
    try {
      const rows = await clientFor(p).models.list({ timeout: 10_000, retry: { maxRetries: 0 } })
      const models = (Array.isArray(rows) ? rows : [])
        .filter((m) => m && typeof m.name === 'string')
        .map((m) => ({ name: m.name, description: m.description || undefined, releaseDate: m.release_date || undefined }))
      return { ok: true, models }
    } catch (err) {
      return { ok: false, ...describeError(err, p) }
    }
  }

  function featureFor(purpose: DecisionPurpose): keyof DecisionFeatures | null {
    if (purpose === 'tool') return 'agentTool'
    if (purpose === 'shell_risk') return 'shellRiskGuard'
    if (purpose === 'routing') return 'routerAssist'
    return null
  }

  async function run(
    p: DecisionProviderConfig,
    input: unknown,
    opts: { timeoutMs?: number; maxRetries?: number; signal?: AbortSignal }
  ): Promise<DecideResult> {
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid request' }
    const req = input as Partial<DecideRequest>
    const qs = normalizeQuestions(req.questions)
    if (!qs.ok) return { ok: false, error: qs.error, code: 'invalid_request' }
    let state = req.state
    if (state === undefined || state === null || state === '') return { ok: false, error: 'state is required', code: 'invalid_request' }
    if (typeof state !== 'string' && typeof state !== 'object') state = String(state)
    const model = typeof req.model === 'string' && MODEL_RE.test(req.model.trim()) ? req.model.trim() : p.model
    // Secrets never leave the machine, even for a local provider (logs, proxies).
    const body = { state: redactDeep(state), questions: redactDeep(qs.questions), model }
    let size = 0
    try {
      size = JSON.stringify(body).length
    } catch {
      return { ok: false, error: 'state must be JSON-serializable', code: 'invalid_request' }
    }
    if (size > DECISION_LIMITS.maxPayloadChars) {
      return { ok: false, error: `Request too large (${size} chars > ${DECISION_LIMITS.maxPayloadChars}); send only what the decision needs`, code: 'too_large' }
    }
    const timeout = Math.min(DECISION_LIMITS.maxTimeoutMs, Math.max(DECISION_LIMITS.minTimeoutMs, Math.round(opts.timeoutMs ?? 15_000)))
    const started = now()
    try {
      const res = await clientFor(p).systemOne(body as never, {
        timeout,
        retry: { maxRetries: Math.max(0, Math.min(3, opts.maxRetries ?? 1)) },
        signal: opts.signal
      })
      const answers: Record<string, DecisionAnswer> = {}
      for (const [k, v] of Object.entries(res?.answers || {})) {
        const a = normalizeAnswer(v)
        if (a) answers[k] = a
      }
      return {
        ok: true,
        model: String(res?.model || model),
        answers,
        usage: res?.usage,
        latencyMs: Math.max(0, now() - started),
        provider: { id: p.id, name: p.name, kind: p.kind, local: isLocalBaseUrl(p.baseUrl) }
      }
    } catch (err) {
      return { ok: false, ...describeError(err, p) }
    }
  }

  /** Answer typed questions with the active provider. */
  async function decide(
    input: unknown,
    opts: { purpose?: DecisionPurpose; timeoutMs?: number; maxRetries?: number; signal?: AbortSignal } = {}
  ): Promise<DecideResult> {
    const cfg = load()
    const p = cfg.providers.find((x) => x.enabled)
    if (!p) return { ok: false, error: 'No decision model is active (Settings → Decision models)', code: 'not_configured' }
    const feature = featureFor(opts.purpose ?? 'tool')
    if (feature && !cfg.features[feature]) return { ok: false, error: `Decision feature "${feature}" is turned off`, code: 'disabled' }
    return run(p, input, opts)
  }

  /** Round-trip check: one yes/no question against the provider's model. */
  async function test(id: unknown): Promise<DecideResult> {
    const p = load().providers.find((x) => x.id === id)
    if (!p) return { ok: false, error: 'Unknown provider' }
    // First call to a local model may wait for it to load.
    return run(
      p,
      {
        state: 'Hi! Could you send me the invoice for last month?',
        questions: { is_request: { type: 'noul', instructions: 'Is the sender asking for something?' } }
      },
      { timeoutMs: p.kind === 'ollaya' || isLocalBaseUrl(p.baseUrl) ? 60_000 : 20_000, maxRetries: 0 }
    )
  }

  return { status, active, saveProvider, removeProvider, setEnabled, setFeatures, listModels, decide, test }
}
