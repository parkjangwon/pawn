import { getModRuntime } from './runtime'

function rows(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
}

export interface MessageBadge {
  id: string
  text: string
  plugin: string
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

const EMPTY: MessageDecor = { badges: [], actions: [], blocks: [] }
const cache = new Map<string, MessageDecor>()
const inflight = new Map<string, Promise<MessageDecor>>()
let cacheGen = -1
let cacheRuntime = -1

export function __resetMessageRenderCacheForTests(): void {
  cache.clear()
  inflight.clear()
  cacheGen = -1
  cacheRuntime = -1
}

function readDecor(out: unknown): MessageDecor {
  const props =
    out && typeof out === 'object' ? (out as { props?: unknown }).props : null
  const rec = props && typeof props === 'object' ? (props as Record<string, unknown>) : null
  if (!rec) return EMPTY
  const badges = rows(rec.badges)
    .filter((b) => typeof b.id === 'string' && typeof b.plugin === 'string')
    .map((b) => ({ id: String(b.id), text: String(b.text ?? ''), plugin: String(b.plugin) }))
  const actions = rows(rec.actions)
    .filter((a) => typeof a.id === 'string' && typeof a.plugin === 'string')
    .map((a) => ({ id: String(a.id), label: String(a.label ?? ''), plugin: String(a.plugin) }))
  const blocks = rows(rec.blocks)
    .filter((b) => typeof b.id === 'string' && typeof b.plugin === 'string')
    .map((b) => ({ id: String(b.id), tree: b.tree, plugin: String(b.plugin) }))
  return { badges, actions, blocks }
}

export async function messageDecorations(input: {
  messageId: string
  role: string
  text: string
  sessionId: string
  generation: number
  /** Bumps when mods load so the empty draw from before session.start is not kept. */
  runtimeGeneration: number
}): Promise<MessageDecor> {
  if (input.generation !== cacheGen || input.runtimeGeneration !== cacheRuntime) {
    cache.clear()
    inflight.clear()
    cacheGen = input.generation
    cacheRuntime = input.runtimeGeneration
  }
  const key = `${input.sessionId}\0${input.messageId}`
  const hit = cache.get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async (): Promise<MessageDecor> => {
    const out = await getModRuntime().emit(
      'message.render',
      {
        messageId: input.messageId,
        role: input.role,
        text: String(input.text || '').slice(0, 20000),
        sessionId: input.sessionId,
        props: { badges: [], actions: [], blocks: [] }
      },
      async (e) => e,
      undefined,
      input.sessionId
    )
    const decor = readDecor(out)
    cache.set(key, decor)
    return decor
  })()
  inflight.set(key, job)
  void job.finally(() => {
    if (inflight.get(key) === job) inflight.delete(key)
  })
  return job
}
