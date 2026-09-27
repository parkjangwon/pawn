/**
 * Transcript → Kiro GenerateAssistantResponse request (pure).
 *
 * Kiro's conversation model: alternating user / assistant turns; tool
 * results ride on the next user turn (userInputMessageContext.toolResults);
 * tool definitions only on the current message; no system role (the system
 * prompt is prepended to the first user turn); every content non-empty.
 */

import type { ToolDefinition } from './toolDefinitionsTypes'
import { extractImageDataUrl, type TranscriptEntry } from './transcript'

export const KIRO_ORIGIN = 'AI_EDITOR'
const MAX_TOOL_NAME = 64
const MAX_DESCRIPTION = 10_000
/** Kiro rejects payloads over ~615 KB. */
const MAX_PAYLOAD_BYTES = 580_000
const EMPTY = '(empty placeholder)'
const TOOL_RESULTS_ONLY = 'Tool results provided.'

interface KiroImage {
  format: string
  source: { bytes: string }
}

interface KiroToolResult {
  toolUseId: string
  content: Array<{ text: string }>
  status: 'success' | 'error'
}

interface UserTurn {
  role: 'user'
  content: string
  images: KiroImage[]
  toolResults: KiroToolResult[]
}

interface AssistantTurn {
  role: 'assistant'
  content: string
  toolUses: Array<{ toolUseId: string; name: string; input: Record<string, unknown> }>
}

type Turn = UserTurn | AssistantTurn

export interface KiroRequestBuild {
  body: { conversationState: Record<string, unknown> }
  /** Kiro tool name → Pawn tool name (for names Kiro could not take verbatim). */
  toolNames: Map<string, string>
  /** Turns dropped to fit the payload limit. */
  trimmedTurns: number
}

/** Dash-form Claude ids (claude-sonnet-4-5) → Kiro dot form (claude-sonnet-4.5). */
export function toKiroModelId(modelId: string): string {
  const id = modelId.replace(/^kiro\//, '').replace(/-\d{8}$/, '')
  return /^claude-/.test(id) ? id.replace(/(\d)-(\d)(?!\d)/g, '$1.$2') : id
}

/** Stable UUID-shaped conversation id per session. */
export function kiroConversationId(sessionId: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < sessionId.length; i++) {
    h1 = Math.imul(h1 ^ sessionId.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 ^ sessionId.charCodeAt(i), 2246822519) >>> 0
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  const a = hex(h1)
  const b = hex(h2)
  const c = hex(Math.imul(h1 ^ h2, 3266489917) >>> 0)
  const d = hex(Math.imul(h2 + 0x9e3779b9, 668265263) >>> 0)
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`
}

/** Kiro rejects additionalProperties and empty `required` arrays. */
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'additionalProperties' || k === '$schema') continue
    if (k === 'required' && Array.isArray(v) && v.length === 0) continue
    out[k] = sanitizeSchema(v)
  }
  return out
}

function kiroToolName(name: string, used: Set<string>): string {
  let n = name.replace(/[^A-Za-z0-9_-]/g, '_')
  if (n.length > MAX_TOOL_NAME) {
    let h = 0
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
    n = `${n.slice(0, MAX_TOOL_NAME - 9)}_${h.toString(36).slice(0, 8)}`
  }
  let candidate = n
  let i = 2
  while (used.has(candidate)) candidate = `${n.slice(0, MAX_TOOL_NAME - 3)}_${i++}`
  used.add(candidate)
  return candidate
}

function imageFrom(dataUrl: string): KiroImage | null {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const fmt = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()
  if (!['png', 'jpeg', 'gif', 'webp'].includes(fmt)) return null
  return { format: fmt, source: { bytes: m[2] } }
}

function lastUser(turns: Turn[]): UserTurn {
  const t = turns[turns.length - 1]
  if (t && t.role === 'user') return t
  const u: UserTurn = { role: 'user', content: '', images: [], toolResults: [] }
  turns.push(u)
  return u
}

function joinText(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return `${a}\n\n${b}`
}

/** Transcript entries → alternating Kiro turns (images attached, tool results placed). */
export function transcriptToTurns(entries: TranscriptEntry[], nameFor: (pawnName: string) => string): Turn[] {
  const turns: Turn[] = []
  for (const e of entries) {
    if (e.role === 'user' || e.role === 'summary') {
      const u = lastUser(turns)
      u.content = joinText(u.content, e.role === 'summary' ? `[Summary of the earlier conversation]\n${e.content}` : e.content)
      if (e.role === 'user') {
        for (const a of e.attachments || []) {
          const img = a.kind === 'image' ? imageFrom(a.dataUrl) : null
          if (img) u.images.push(img)
        }
      }
      continue
    }
    if (e.role === 'assistant') {
      const prev = turns[turns.length - 1]
      const uses = (e.toolCalls || []).map((tc) => ({
        toolUseId: tc.id,
        name: nameFor(tc.toolset ? `${tc.toolset}_${tc.name}` : tc.name),
        input: tc.arguments && typeof tc.arguments === 'object' ? tc.arguments : {}
      }))
      if (prev && prev.role === 'assistant') {
        prev.content = joinText(prev.content, e.content || '')
        prev.toolUses.push(...uses)
      } else {
        if (!prev) turns.push({ role: 'user', content: '(conversation start)', images: [], toolResults: [] })
        turns.push({ role: 'assistant', content: e.content || '', toolUses: uses })
      }
      continue
    }
    // tool result → next user turn
    const u = lastUser(turns)
    let text = typeof e.content === 'string' ? e.content : String(e.content)
    const url = extractImageDataUrl(text)
    if (url) {
      const img = imageFrom(url)
      if (img) u.images.push(img)
      text = text.replace(url, '').trim() || '[image attached]'
    }
    u.toolResults.push({ toolUseId: e.toolCallId, content: [{ text: text || '(empty result)' }], status: e.isError ? 'error' : 'success' })
  }
  return turns
}

/**
 * Make the turn list valid for Kiro: tool results only after the assistant
 * turn that requested them (orphans become text), images only on the current
 * turn, non-empty content everywhere.
 */
function normalize(turns: Turn[], hasTools: boolean): Turn[] {
  const out: Turn[] = turns.map((t) => (t.role === 'user' ? { ...t, images: [...t.images], toolResults: [...t.toolResults] } : { ...t, toolUses: [...t.toolUses] }))
  for (let i = 0; i < out.length; i++) {
    const t = out[i]
    if (t.role !== 'user' || !t.toolResults.length) continue
    const prev = out[i - 1]
    const asked = new Set(prev && prev.role === 'assistant' ? prev.toolUses.map((u) => u.toolUseId) : [])
    const keep: KiroToolResult[] = []
    const orphans: string[] = []
    for (const r of t.toolResults) {
      if (hasTools && asked.has(r.toolUseId)) keep.push(r)
      else orphans.push(`[tool result ${r.toolUseId}${r.status === 'error' ? ' (error)' : ''}]\n${r.content.map((c) => c.text).join('\n')}`)
    }
    t.toolResults = keep
    if (orphans.length) t.content = joinText(orphans.join('\n\n'), t.content)
  }
  // Without tool definitions Kiro rejects toolUses in history too.
  if (!hasTools) {
    for (const t of out) {
      if (t.role === 'assistant' && t.toolUses.length) {
        t.content = joinText(t.content, t.toolUses.map((u) => `[called ${u.name} ${JSON.stringify(u.input).slice(0, 500)}]`).join('\n'))
        t.toolUses = []
      }
    }
  }
  for (let i = 0; i < out.length; i++) {
    const t = out[i]
    if (t.role === 'user') {
      if (i < out.length - 1) t.images = [] // Kiro takes images on the current message
      if (!t.content.trim()) t.content = t.toolResults.length ? TOOL_RESULTS_ONLY : EMPTY
    } else if (!t.content.trim()) {
      t.content = EMPTY
    }
  }
  return out
}

export function buildKiroRequest(opts: {
  entries: TranscriptEntry[]
  systemText: string
  tools: ToolDefinition[]
  modelId: string
  conversationId: string
  maxBytes?: number
}): KiroRequestBuild {
  const used = new Set<string>()
  const toKiro = new Map<string, string>()
  const toPawn = new Map<string, string>()
  const nameFor = (pawn: string): string => {
    let k = toKiro.get(pawn)
    if (!k) {
      k = kiroToolName(pawn, used)
      toKiro.set(pawn, k)
      toPawn.set(k, pawn)
    }
    return k
  }
  const toolSpecs = opts.tools.map((t) => ({
    toolSpecification: {
      name: nameFor(t.name),
      description: (t.description || `Tool: ${t.name}`).slice(0, MAX_DESCRIPTION),
      inputSchema: { json: sanitizeSchema(t.parameters || { type: 'object', properties: {} }) }
    }
  }))
  const modelId = toKiroModelId(opts.modelId)
  let turns = normalize(transcriptToTurns(opts.entries, nameFor), toolSpecs.length > 0)
  if (!turns.length || turns[turns.length - 1].role !== 'user') {
    turns.push({ role: 'user', content: 'Please continue.', images: [], toolResults: [] })
    turns = normalize(turns, toolSpecs.length > 0)
  }

  const userMsg = (t: UserTurn, current: boolean): Record<string, unknown> => {
    const ctx: Record<string, unknown> = {}
    if (current && toolSpecs.length) ctx.tools = toolSpecs
    if (t.toolResults.length) ctx.toolResults = t.toolResults
    return {
      userInputMessage: {
        content: t.content,
        modelId,
        origin: KIRO_ORIGIN,
        ...(current && t.images.length ? { images: t.images } : {}),
        ...(Object.keys(ctx).length ? { userInputMessageContext: ctx } : {})
      }
    }
  }
  const assistantMsg = (t: AssistantTurn): Record<string, unknown> => ({
    assistantResponseMessage: { content: t.content, ...(t.toolUses.length ? { toolUses: t.toolUses } : {}) }
  })

  const render = (list: Turn[]): { conversationState: Record<string, unknown> } => {
    const withSystem = list.map((t, i) => (i === 0 && t.role === 'user' && opts.systemText ? { ...t, content: `${opts.systemText}\n\n${t.content}` } : t))
    const history = withSystem.slice(0, -1).map((t) => (t.role === 'user' ? userMsg(t, false) : assistantMsg(t)))
    const current = withSystem[withSystem.length - 1] as UserTurn
    return {
      conversationState: {
        chatTriggerType: 'MANUAL',
        conversationId: opts.conversationId,
        currentMessage: userMsg(current, true),
        ...(history.length ? { history } : {})
      }
    }
  }

  // Trim the oldest user+assistant pairs until the payload fits.
  const limit = opts.maxBytes ?? MAX_PAYLOAD_BYTES
  let trimmed = 0
  let body = render(turns)
  while (new TextEncoder().encode(JSON.stringify(body)).length > limit && turns.length > 2) {
    // Cut at a user turn that does not carry results of the dropped calls.
    let cut = 2
    while (cut < turns.length - 1 && (turns[cut].role !== 'user' || (turns[cut] as UserTurn).toolResults.length > 0)) cut++
    if (cut >= turns.length - 1) {
      cut = 2
      while (cut < turns.length - 1 && turns[cut].role !== 'user') cut++
    }
    const dropped = turns.slice(0, cut)
    const rest = turns.slice(cut)
    // Results of calls that were just dropped cannot stay (they would be orphans).
    const head = rest[0]
    if (head && head.role === 'user' && head.toolResults.length) rest[0] = { ...head, toolResults: [] }
    turns = normalize(
      ([{ role: 'user', content: `[${dropped.length} earlier messages omitted to fit Kiro's request size limit]`, images: [], toolResults: [] }, ...rest] as Turn[]).reduce<Turn[]>((acc, t) => {
        const prev = acc[acc.length - 1]
        if (prev && prev.role === 'user' && t.role === 'user') {
          prev.content = joinText(prev.content, t.content)
          prev.toolResults.push(...t.toolResults)
          prev.images.push(...t.images)
        } else acc.push(t.role === 'user' ? ({ ...t, toolResults: [...t.toolResults], images: [...t.images] } as UserTurn) : { ...t })
        return acc
      }, []),
      toolSpecs.length > 0
    )
    trimmed += dropped.length
    body = render(turns)
  }
  return { body, toolNames: toPawn, trimmedTurns: trimmed }
}
