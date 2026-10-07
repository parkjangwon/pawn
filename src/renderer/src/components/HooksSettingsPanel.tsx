import { useCallback, useEffect, useMemo, useState } from 'react'
import { tx } from '../i18n'
import { useAppStore } from '../stores/app'
import { getEffectiveProjectPath } from '../utils/projectPath'
import Input from './Input'
import Switch from './Switch'

interface HooksSettings {
  enabled: boolean
  readClaude: boolean
  readPawn: boolean
  allowProjectHooks: boolean
}

interface HookRow {
  id: string
  event: string
  matcher: string
  type: string
  commandOrUrl: string
  source: string
}

const defaultSettings: HooksSettings = {
  enabled: true,
  readClaude: true,
  readPawn: true,
  allowProjectHooks: false
}

/** Events in lifecycle order; unknown events sort alphabetically after. */
const EVENT_ORDER = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'SessionEnd',
  'Notification'
]

const INTERPRETERS = new Set([
  'node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'bash', 'sh', 'zsh', 'fish', 'ruby', 'perl', 'osascript'
])

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** The command is usually "interpreter /very/long/path/script.js args…" —
 * surface the script name and arguments, keep the full text one click away. */
function hookLabel(commandOrUrl: string): string {
  const s = (commandOrUrl || '').trim()
  if (!s) return '—'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s // URL hook
  const tokens: string[] = []
  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  let out = tokens
  if (tokens.length >= 2 && INTERPRETERS.has(basename(tokens[0]).toLowerCase())) {
    out = [basename(tokens[1]), ...tokens.slice(2)]
  } else if (tokens.length) {
    out = [basename(tokens[0]), ...tokens.slice(1)]
  }
  let label = out.join(' ')
  if (label.length > 72) label = label.slice(0, 71) + '…'
  return label || s
}

function groupRank(event: string): number {
  const i = EVENT_ORDER.indexOf(event)
  return i >= 0 ? i : EVENT_ORDER.length
}

export default function HooksSettingsPanel(): React.JSX.Element {
  const projectPath = useAppStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId)
    return getEffectiveProjectPath(p, useAppStore.getState().activeSessionId) || null
  })
  const [settings, setSettings] = useState<HooksSettings>(defaultSettings)
  const [hooks, setHooks] = useState<HookRow[]>([])
  const [bySource, setBySource] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expandedCmds, setExpandedCmds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!window.api.hooks) return
    try {
      const list = await window.api.hooks.list(projectPath)
      setSettings({ ...defaultSettings, ...(list?.settings || {}) })
      setHooks(list?.hooks || [])
      setBySource(list?.bySource || {})
    } catch (e) {
      setMsg(String(e))
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const patch = async (partial: Partial<HooksSettings>) => {
    if (!window.api.hooks?.setSettings) return
    setBusy(true)
    try {
      const next = await window.api.hooks.setSettings(partial)
      setSettings({ ...defaultSettings, ...(next || {}) })
      setMsg('Saved')
      void refresh()
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleGroup = (event: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })
  }

  const toggleCmd = (id: string): void => {
    setExpandedCmds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyCmd = async (h: HookRow): Promise<void> => {
    try {
      await navigator.clipboard.writeText(h.commandOrUrl)
      setCopiedId(h.id)
      setTimeout(() => setCopiedId((cur) => (cur === h.id ? null : cur)), 1500)
    } catch {
      setMsg('Could not copy to the clipboard')
    }
  }

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const filtered = q
      ? hooks.filter((h) =>
          (h.event + ' ' + h.matcher + ' ' + h.commandOrUrl + ' ' + h.source).toLowerCase().includes(q)
        )
      : hooks
    const map = new Map<string, HookRow[]>()
    for (const h of filtered) {
      map.set(h.event, [...(map.get(h.event) || []), h])
    }
    return [...map.entries()]
      .map(([event, rows]) => ({ event, rows: rows.sort((a, b) => a.source.localeCompare(b.source)) }))
      .sort((a, b) => groupRank(a.event) - groupRank(b.event) || a.event.localeCompare(b.event))
  }, [hooks, filter])

  if (!window.api.hooks) {
    return <div className="settings-empty">{'Hooks run in the desktop app.'}</div>
  }

  return (
    <div className="hooks-settings">
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Use hooks'}</span>
            <span className="settings-row-desc">{'Fire lifecycle hooks from Claude and Pawn config files'}</span>
          </div>
          <Switch
            checked={settings.enabled}
            disabled={busy}
            onCheckedChange={(v) => void patch({ enabled: v })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Read Claude settings'}</span>
            <span className="settings-row-desc">{'~/.claude/settings.json and project .claude/settings.json'}</span>
          </div>
          <Switch
            checked={settings.readClaude}
            disabled={busy || !settings.enabled}
            onCheckedChange={(v) => void patch({ readClaude: v })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Read Pawn hooks'}</span>
            <span className="settings-row-desc">{'~/.pawn/hooks.json and project .pawn/hooks.json'}</span>
          </div>
          <Switch
            checked={settings.readPawn}
            disabled={busy || !settings.enabled}
            onCheckedChange={(v) => void patch({ readPawn: v })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Run project hooks'}</span>
            <span className="settings-row-desc">{'Run hooks from the opened repo\'s .claude/settings.json / .pawn/hooks.json. Off by default — those files ship with untrusted repos and can execute arbitrary commands. User-scope hooks always run.'}</span>
          </div>
          <Switch
            checked={settings.allowProjectHooks}
            disabled={busy || !settings.enabled}
            onCheckedChange={(v) => void patch({ allowProjectHooks: v })}
          />
        </div>
        <div className="hooks-stats">
          {`${hooks.length} hooks loaded · ${Object.entries(bySource)
              .map(([k, n]) => k + ':' + n)
              .join(' · ') || '—'}`}
        </div>
        {msg && <div className="hooks-msg">{msg}</div>}
      </div>

      <div className="settings-card hooks-browser">
        <div className="hooks-toolbar">
          <span className="settings-row-label">{'Loaded hooks'}</span>
          <Input
            className="hooks-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={'Filter events or commands…'}
          />
          <button type="button" className="test-btn" onClick={() => void refresh()} disabled={busy}>
            {'Refresh'}
          </button>
        </div>
        {hooks.length === 0 ? (
          <div className="settings-empty">{'No hooks found. Add them under ~/.claude/settings.json or ~/.pawn/hooks.json.'}</div>
        ) : groups.length === 0 ? (
          <div className="settings-empty">{'No hooks match the filter.'}</div>
        ) : (
          <div className="hooks-groups">
            {groups.map(({ event, rows }) => {
              const isCollapsed = collapsed.has(event)
              return (
                <section key={event} className="hooks-group">
                  <button
                    type="button"
                    className="hooks-group-head"
                    onClick={() => toggleGroup(event)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className={'hooks-chevron' + (isCollapsed ? ' is-collapsed' : '')}>▾</span>
                    <span className="hooks-group-event">{event}</span>
                    <span className="hooks-group-count">{rows.length}</span>
                  </button>
                  {!isCollapsed && (
                    <ul className="hooks-list">
                      {rows.map((h) => {
                        const isExpanded = expandedCmds.has(h.id)
                        return (
                          <li key={h.id} className="hooks-row">
                            <div className="hooks-row-badges">
                              <span className="settings-badge">{h.source}</span>
                              {h.matcher && h.matcher !== '*' && (
                                <span className="settings-badge hooks-badge-matcher">{h.matcher}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="hooks-cmd"
                              title={'Toggle full command'}
                              onClick={() => toggleCmd(h.id)}
                            >
                              {isExpanded ? h.commandOrUrl : hookLabel(h.commandOrUrl)}
                            </button>
                            <div className={'hooks-row-actions' + (copiedId === h.id ? ' is-visible' : '')}>
                              <button
                                type="button"
                                className="hooks-icon-btn"
                                title={'Copy command'}
                                onClick={() => void copyCmd(h)}
                              >
                                {copiedId === h.id ? '✓' : '⧉'}
                              </button>
                              <button
                                type="button"
                                className={'hooks-icon-btn hooks-expand' + (isExpanded ? ' is-open' : '')}
                                title={'Toggle full command'}
                                onClick={() => toggleCmd(h.id)}
                              >
                                ▾
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
