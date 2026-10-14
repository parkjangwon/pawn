import { getModRuntime } from './runtime'

/**
 * `message.render`: mods add badges, actions and custom blocks to a finished
 * message. Streaming rows are never sent (the caller skips them), results are
 * cached per (chat, message, text) and dropped when mods reload or redraw.
 */

export interface MessageBadge {
  id: string
  text: string
  plugin: string
  tone?: 'info' | 'success' | 'warning' | 'danger'
}
export interface MessageAction {
  id: string
  label: string
  plugin: string
}
export interface MessageBlock {
  id: string
  tree: unknown
  plugin: string
}
export interface MessageDecor {
  badges: MessageBadge[]
  actions: MessageAction[]
  blocks: MessageBlock[]
}

export const EMPTY_DECOR: MessageDecor = Object.freeze({ badges: [], actions: [], blocks: [] }) as MessageDecor

/** Per message, so one chatty mod cannot flood a row. */
const MAX_PER_KIND = 8
const TEXT_CAP = 20_000
const TONES = new Set(['info', 'success', 'warning', 'danger'])

const cache = new Map<string, MessageDecor>()
const inflight = new Map<string, Promise<MessageDecor>>()
let cacheStamp = ''

export function __resetMessageRenderCacheForTests(): void {
  cache.clear()
  inflight.clear()
  cacheStamp = ''
}

function rows(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
}

function owned(r: Record<string, unknown>): boolean {
  return typeof r.id === 'string' && r.id.length > 0 && typeof r.plugin === 'string' && r.plugin.length > 0
}

export function readDecor(out: unknown): MessageDecor {
  const props = out && typeof out === 'object' ? (out as { props?: unknown }).props : null
  const rec = props && typeof props === 'object' ? (props as Record<string, unknown>) : null
  if (!rec) return EMPTY_DECOR
  const badges = rows(rec.badges)
    .filter(owned)
    .slice(0, MAX_PER_KIND)
    .map((b) => ({
      id: String(b.id),
      text: String(b.text ?? '').slice(0, 40),
      plugin: String(b.plugin),
      tone: TONES.has(String(b.tone)) ? (String(b.tone) as MessageBadge['tone']) : undefined
    }))
  const actions = rows(rec.actions)
    .filter(owned)
    .slice(0, MAX_PER_KIND)
    .map((a) => ({ id: String(a.id), label: String(a.label ?? a.id).slice(0, 40), plugin: String(a.plugin) }))
  const blocks = rows(rec.blocks)
    .filter(owned)
    .slice(0, MAX_PER_KIND)
    .map((b) => ({ id: String(b.id), tree: b.tree, plugin: String(b.plugin) }))
  if (!badges.length && !actions.length && !blocks.length) return EMPTY_DECOR
  return { badges, actions, blocks }
}

function hashText(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${text.length}:${(h >>> 0).toString(36)}`
}

export interface MessageRenderInput {
  messageId: string
  role: string
  text: string
  sessionId: string
  /** uiStore.renderGeneration: a mod asked for a redraw. */
  generation: number
  /** uiStore.runtimeGeneration: mods (re)loaded. */
  runtimeGeneration: number
}

/** Sync read for the first paint, so a remount does not flash. */
export function cachedMessageDecor(input: MessageRenderInput): MessageDecor | undefined {
  if (`${input.generation}:${input.runtimeGeneration}` !== cacheStamp) return undefined
  return cache.get(`${input.sessionId}\0${input.messageId}\0${hashText(input.text)}`)
}

export async function messageDecorations(input: MessageRenderInput): Promise<MessageDecor> {
  const runtime = getModRuntime()
  if (!runtime.hasHooks('message.render')) return EMPTY_DECOR
  const stamp = `${input.generation}:${input.runtimeGeneration}`
  if (stamp !== cacheStamp) {
    cache.clear()
    inflight.clear()
    cacheStamp = stamp
  }
  const text = String(input.text || '').slice(0, TEXT_CAP)
  const key = `${input.sessionId}\0${input.messageId}\0${hashText(input.text)}`
  const hit = cache.get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async (): Promise<MessageDecor> => {
    let decor = EMPTY_DECOR
    try {
      const out = await runtime.emit(
        'message.render',
        {
          messageId: input.messageId,
          role: input.role,
          text,
          sessionId: input.sessionId,
          props: { badges: [], actions: [], blocks: [] }
        },
        async (e) => e,
        undefined,
        input.sessionId
      )
      decor = readDecor(out)
    } catch {
      decor = EMPTY_DECOR
    }
    if (cacheStamp === stamp) cache.set(key, decor)
    return decor
  })()
  inflight.set(key, job)
  void job.finally(() => {
    if (inflight.get(key) === job) inflight.delete(key)
  })
  return job
}
