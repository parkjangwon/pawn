/**
 * Runtime events of embedded-browser tabs — console messages, uncaught
 * exceptions, failed network requests, renderer crashes and load failures —
 * kept per tab in a bounded ring with a monotonic sequence number, so the
 * agent can ask "what went wrong since my last action?".
 */

export type RuntimeEventKind = 'console' | 'exception' | 'network' | 'crash' | 'load'
export type RuntimeLevel = 'error' | 'warn' | 'info' | 'debug'

export interface RuntimeEvent {
  seq: number
  at: number
  kind: RuntimeEventKind
  level: RuntimeLevel
  text: string
  source?: string
  url?: string
  status?: number
  method?: string
}

const MAX_EVENTS = 400

export class RuntimeEventLog {
  private seq = 0
  private byTab = new Map<string, RuntimeEvent[]>()

  push(tabId: string, e: Omit<RuntimeEvent, 'seq' | 'at'>): RuntimeEvent {
    const ev: RuntimeEvent = { ...e, text: e.text.slice(0, 2000), seq: ++this.seq, at: Date.now() }
    let list = this.byTab.get(tabId)
    if (!list) {
      list = []
      this.byTab.set(tabId, list)
    }
    // Collapse exact repeats (render loops spam the same error).
    const last = list[list.length - 1]
    if (last && last.kind === ev.kind && last.text === ev.text && last.url === ev.url) {
      last.seq = ev.seq
      last.at = ev.at
      ;(last as RuntimeEvent & { repeat?: number }).repeat = ((last as RuntimeEvent & { repeat?: number }).repeat || 1) + 1
      return last
    }
    list.push(ev)
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS)
    return ev
  }

  get latestSeq(): number {
    return this.seq
  }

  events(tabId: string, opts: { since?: number; kinds?: RuntimeEventKind[]; minLevel?: RuntimeLevel; limit?: number } = {}): RuntimeEvent[] {
    const rank: Record<RuntimeLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
    const min = rank[opts.minLevel || 'debug']
    const list = (this.byTab.get(tabId) || []).filter(
      (e) =>
        e.seq > (opts.since || 0) &&
        rank[e.level] >= min &&
        (!opts.kinds?.length || opts.kinds.includes(e.kind))
    )
    const limit = Math.max(1, Math.min(300, opts.limit || 100))
    return list.slice(-limit)
  }

  clear(tabId: string): void {
    this.byTab.set(tabId, [])
  }

  drop(tabId: string): void {
    this.byTab.delete(tabId)
  }
}

/** Electron's console-message: new object form (35+) or legacy positional args. */
export function parseConsoleMessage(args: unknown[]): { level: RuntimeLevel; message: string; source?: string } {
  const first = args[0] as Record<string, unknown> | undefined
  let level: unknown
  let message: unknown
  let line: unknown
  let sourceId: unknown
  if (first && typeof first === 'object' && 'message' in first) {
    ;({ level, message, lineNumber: line, sourceId } = first as Record<string, unknown>)
  } else {
    ;[, level, message, line, sourceId] = args
  }
  const lv: RuntimeLevel =
    level === 3 || level === 'error'
      ? 'error'
      : level === 2 || level === 'warning' || level === 'warn'
        ? 'warn'
        : level === -1 || level === 'debug' || level === 'verbose'
          ? 'debug'
          : 'info'
  const src = typeof sourceId === 'string' && sourceId ? `${sourceId}${typeof line === 'number' ? `:${line}` : ''}` : undefined
  return { level: lv, message: String(message ?? ''), ...(src ? { source: src } : {}) }
}

/** Compact text for the agent. */
export function formatRuntimeEvents(events: RuntimeEvent[], opts: { header?: string } = {}): string {
  if (!events.length) return opts.header ? `${opts.header}: none` : 'No runtime events.'
  const lines = events.map((e) => {
    const rep = (e as RuntimeEvent & { repeat?: number }).repeat
    const tag = e.kind === 'network' ? `${e.method || 'GET'} ${e.status ?? 'ERR'}` : e.kind === 'console' ? e.level : e.kind
    const where = e.kind === 'network' ? '' : e.source ? ` (${e.source})` : ''
    return `- [${tag}] ${e.kind === 'network' ? `${e.url} ${e.text}`.trim() : e.text}${where}${rep && rep > 1 ? ` ×${rep}` : ''}`
  })
  return `${opts.header ? `${opts.header}:\n` : ''}${lines.join('\n')}`
}
