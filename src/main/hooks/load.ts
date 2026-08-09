import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type {
  HookEventName,
  HookHandler,
  HookMatcherGroup,
  HooksConfig,
  HookSource,
  LoadedHook
} from './types'
import { HOOK_EVENTS } from './types'
import { getHooksSettings } from './settings'
import { getPawnDir } from '../config'

function fingerprintHandler(event: HookEventName, matcher: string, h: HookHandler): string {
  const body =
    h.type === 'http'
      ? `http|${(h.url || '').trim()}`
      : `command|${(h.command || '').trim().replace(/\s+/g, ' ')}`
  return createHash('sha256')
    .update(`${event}|${matcher}|${body}`)
    .digest('hex')
    .slice(0, 16)
}

function parseHooksObject(raw: unknown): HooksConfig {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const out: HooksConfig = {}
  for (const event of HOOK_EVENTS) {
    const groups = obj[event]
    if (!Array.isArray(groups)) continue
    const parsed: HookMatcherGroup[] = []
    for (const g of groups) {
      if (!g || typeof g !== 'object') continue
      const group = g as Record<string, unknown>
      const hooksRaw = group.hooks
      if (!Array.isArray(hooksRaw)) continue
      const hooks: HookHandler[] = []
      for (const h of hooksRaw) {
        if (!h || typeof h !== 'object') continue
        const hh = h as Record<string, unknown>
        const type = hh.type === 'http' ? 'http' : hh.type === 'command' || hh.command ? 'command' : null
        if (!type) continue
        // Claude advanced types: map `prompt` hooks that still include a shell
        // command field; skip pure agent/mcp_tool (no local runner yet).
        if (hh.type === 'agent' || hh.type === 'mcp_tool') continue
        if (hh.type === 'prompt' && !hh.command) continue
        if (type === 'http') {
          const url = String(hh.url || '').trim()
          if (!url) continue
          hooks.push({
            type: 'http',
            url,
            timeout: hh.timeout != null ? Number(hh.timeout) : undefined,
            statusMessage: hh.statusMessage != null ? String(hh.statusMessage) : undefined,
            async: hh.async === true
          })
        } else {
          const command = String(hh.command || '').trim()
          if (!command) continue
          hooks.push({
            type: 'command',
            command,
            timeout: hh.timeout != null ? Number(hh.timeout) : undefined,
            statusMessage: hh.statusMessage != null ? String(hh.statusMessage) : undefined,
            async: hh.async === true
          })
        }
      }
      if (hooks.length) {
        parsed.push({
          matcher: group.matcher != null ? String(group.matcher) : '*',
          hooks
        })
      }
    }
    if (parsed.length) out[event] = parsed
  }
  return out
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function extractHooksFromSettings(data: unknown): HooksConfig {
  if (!data || typeof data !== 'object') return {}
  const root = data as Record<string, unknown>
  // Claude: { hooks: { PreToolUse: [...] } }
  // Pawn hooks.json: same, or top-level events
  if (root.hooks && typeof root.hooks === 'object') {
    return parseHooksObject(root.hooks)
  }
  return parseHooksObject(root)
}

function flatten(
  config: HooksConfig,
  source: HookSource,
  into: LoadedHook[]
): void {
  for (const event of HOOK_EVENTS) {
    const groups = config[event]
    if (!groups) continue
    for (const g of groups) {
      const matcher = g.matcher ?? '*'
      for (const handler of g.hooks) {
        const fp = fingerprintHandler(event, matcher, handler)
        into.push({
          id: `${source}:${event}:${fp}`,
          event,
          matcher,
          handler,
          source,
          fingerprint: fp
        })
      }
    }
  }
}

/** Load + merge + dedupe hooks from Claude and Pawn sources. */
export function loadAllHooks(projectPath?: string | null): LoadedHook[] {
  const settings = getHooksSettings()
  if (!settings.enabled) return []

  const collected: LoadedHook[] = []
  const home = homedir()

  if (settings.readClaude) {
    flatten(
      extractHooksFromSettings(readJsonFile(join(home, '.claude', 'settings.json'))),
      'claude:user',
      collected
    )
    if (projectPath) {
      flatten(
        extractHooksFromSettings(readJsonFile(join(projectPath, '.claude', 'settings.json'))),
        'claude:project',
        collected
      )
    }
  }

  if (settings.readPawn) {
    flatten(
      extractHooksFromSettings(readJsonFile(join(getPawnDir(), 'hooks.json'))),
      'pawn:user',
      collected
    )
    if (projectPath) {
      flatten(
        extractHooksFromSettings(readJsonFile(join(projectPath, '.pawn', 'hooks.json'))),
        'pawn:project',
        collected
      )
    }
  }

  // Dedupe by fingerprint (same command/url + event + matcher) — first source wins for display
  const seen = new Set<string>()
  const unique: LoadedHook[] = []
  for (const h of collected) {
    if (seen.has(h.fingerprint)) continue
    seen.add(h.fingerprint)
    unique.push(h)
  }
  return unique
}

export function listHooksSummary(projectPath?: string | null): {
  settings: ReturnType<typeof getHooksSettings>
  hooks: Array<{
    id: string
    event: HookEventName
    matcher: string
    type: string
    commandOrUrl: string
    source: HookSource
  }>
  bySource: Record<string, number>
  byEvent: Record<string, number>
} {
  const settings = getHooksSettings()
  const hooks = loadAllHooks(projectPath)
  const bySource: Record<string, number> = {}
  const byEvent: Record<string, number> = {}
  for (const h of hooks) {
    bySource[h.source] = (bySource[h.source] || 0) + 1
    byEvent[h.event] = (byEvent[h.event] || 0) + 1
  }
  return {
    settings,
    hooks: hooks.map((h) => ({
      id: h.id,
      event: h.event,
      matcher: h.matcher,
      type: h.handler.type,
      commandOrUrl:
        h.handler.type === 'http' ? h.handler.url || '' : (h.handler.command || '').slice(0, 200),
      source: h.source
    })),
    bySource,
    byEvent
  }
}
