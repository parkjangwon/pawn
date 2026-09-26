/**
 * Tool diet: optional tool groups that are only sent to the model when needed.
 *
 * Sending all ~130 tool schemas on every request costs ~17k tokens and makes
 * tool choice noisier (especially for small models). Core coding tools stay
 * always-on; optional groups are exposed when any of these is true:
 *   - the session already used one of the group's tools (or called load_tools)
 *   - a user message / summary mentions the group (browser, GitHub, Gmail, …)
 * Account-backed groups (GitHub, GitLab, Google, CodeCommit) are additionally
 * hidden while the account is not connected.
 *
 * Everything is derived from the transcript, so the tool list is stable across
 * rounds and reloads (prompt-cache friendly) and only ever grows in a session.
 */

import type { TranscriptEntry } from './transcript'

export type ToolGroupId = 'browser' | 'computer' | 'github' | 'gitlab' | 'google' | 'codecommit' | 'app'
export type ConnectionProvider = 'github' | 'gitlab' | 'google' | 'codecommit'
export type ToolLoadingMode = 'smart' | 'all'

interface ToolGroup {
  id: ToolGroupId
  /** Tool-name prefix owning the group. */
  prefix: string
  /** Names with the prefix that stay always-on (core). */
  keepCore?: string[]
  connection?: ConnectionProvider
  /** Signals in user text that the group will likely be needed. */
  keywords: RegExp
  summary: string
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'browser',
    prefix: 'browser_',
    keywords:
      /\bbrowser\b|\bwebsite\b|web ?page|\bweb ?app\b|\blocalhost\b|https?:\/\/|\blog ?in\b|\bsign ?in\b|\bclick\b|<browser_selection|브라우저|웹사이트|웹 ?페이지|사이트|로그인|클릭|ブラウザ|サイト|ページ|ログイン|浏览器|网页|网站|登录|点击/i,
    summary: 'embedded browser: navigate, snapshot, click, fill, eval, tabs'
  },
  {
    id: 'computer',
    prefix: 'computer_',
    keywords:
      /\bscreen(shot)?\b|\bdesktop\b|\bmouse\b|\bkeyboard\b|computer[ _-]?use|\bfinder\b|\bdock\b|화면|스크린샷|마우스|키보드|데스크톱|바탕화면|画面|スクリーンショット|マウス|デスクトップ|屏幕|截图|鼠标|桌面/i,
    summary: 'desktop control: screenshot, mouse, keyboard, clipboard'
  },
  {
    id: 'github',
    prefix: 'github_',
    connection: 'github',
    keywords: /github|pull request|\bPRs?\b|\bissues?\b|깃허브|이슈|풀 ?리퀘스트|プルリク|イシュー|拉取请求|议题/i,
    summary: 'GitHub repos, issues, pull requests, code search, reviews'
  },
  {
    id: 'gitlab',
    prefix: 'gitlab_',
    connection: 'gitlab',
    keywords: /gitlab|merge request|\bMRs?\b|깃랩|머지 ?리퀘스트/i,
    summary: 'GitLab projects, issues, merge requests, search'
  },
  {
    id: 'google',
    prefix: 'google_',
    connection: 'google',
    keywords:
      /google|gmail|calendar|spreadsheet|\be-?mail\b|\binbox\b|구글|지메일|메일|드라이브|캘린더|일정|스프레드시트|슬라이드|メール|カレンダー|ドライブ|スプレッドシート|邮件|日历|云端硬盘|电子表格/i,
    summary: 'Gmail, Drive, Calendar, Tasks, Sheets, Docs, Slides'
  },
  {
    id: 'codecommit',
    prefix: 'codecommit_',
    connection: 'codecommit',
    keywords: /codecommit|\baws\b/i,
    summary: 'AWS CodeCommit repos, branches, commits, files'
  },
  {
    id: 'app',
    prefix: 'app_',
    // Mode switching is part of the core coding workflow (Plan ↔ Build).
    keepCore: ['app_set_agent_mode'],
    keywords:
      /\btheme\b|dark mode|light mode|\bautomation\b|\bschedule\b|\broutine\b|\bcron\b|permission mode|\bswitch (the )?model\b|reasoning effort|\bopen (the )?(terminal|git|files|diff|browser) (tab|panel)\b|테마|다크 ?모드|자동화|스케줄|예약|권한 ?모드|모델 ?(바꿔|변경)|テーマ|自動化|スケジュール|主题|自动化|定时/i,
    summary: 'app control: model, permission mode, reasoning, theme, panels, automations'
  }
]

const GROUP_BY_ID = new Map(TOOL_GROUPS.map((g) => [g.id, g]))

export const TOOL_GROUP_IDS: ToolGroupId[] = TOOL_GROUPS.map((g) => g.id)

export function isToolGroupId(v: unknown): v is ToolGroupId {
  return typeof v === 'string' && GROUP_BY_ID.has(v as ToolGroupId)
}

/** Group owning `toolName`, or null for core tools. */
export function groupOfTool(toolName: string): ToolGroup | null {
  for (const g of TOOL_GROUPS) {
    if (toolName.startsWith(g.prefix)) return g.keepCore?.includes(toolName) ? null : g
  }
  return null
}

function groupsFromArg(raw: unknown): ToolGroupId[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : []
  return list.map((x) => String(x).trim().toLowerCase()).filter(isToolGroupId)
}

/** Groups the session needs, derived from its transcript. Monotonic by construction. */
export function activeToolGroups(entries: TranscriptEntry[]): Set<ToolGroupId> {
  const active = new Set<ToolGroupId>()
  for (const e of entries) {
    if (e.role === 'assistant') {
      for (const tc of e.toolCalls || []) {
        if (tc.name === 'load_tools') {
          for (const g of groupsFromArg(tc.arguments.groups)) active.add(g)
          continue
        }
        const g = groupOfTool(tc.name)
        if (g) active.add(g.id)
      }
    } else if (e.role === 'user' || e.role === 'summary') {
      const text = e.content || ''
      for (const g of TOOL_GROUPS) {
        if (active.has(g.id)) continue
        // Summaries list "Tools used: browser_click×3" — count those too.
        if (g.keywords.test(text) || text.includes(g.prefix)) active.add(g.id)
      }
    }
  }
  return active
}

/**
 * Connected accounts, or null when unknown (fail open: never hide account
 * tools just because the status lookup failed).
 */
let connectedCache: Set<ConnectionProvider> | null = null
let connectedFetchedAt = 0
const CONNECTED_TTL_MS = 30_000

export function setConnectedProviders(list: ConnectionProvider[] | null): void {
  connectedCache = list ? new Set(list) : null
  connectedFetchedAt = Date.now()
}

export function getConnectedProviders(): Set<ConnectionProvider> | null {
  return connectedCache
}

/** Refresh the connection cache (bounded wait; keeps the old value on failure). */
export async function refreshConnectedProviders(timeoutMs = 800): Promise<Set<ConnectionProvider> | null> {
  if (connectedCache && Date.now() - connectedFetchedAt < CONNECTED_TTL_MS) return connectedCache
  const list = window.api?.connections?.list
  if (typeof list !== 'function') return connectedCache
  try {
    const rows = await Promise.race([
      list(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ])
    if (Array.isArray(rows)) {
      setConnectedProviders(rows.filter((r) => r.connected).map((r) => r.provider))
    }
  } catch {
    /* keep previous */
  }
  return connectedCache
}

export function isGroupAvailable(group: ToolGroupId, connected: Set<ConnectionProvider> | null): boolean {
  const g = GROUP_BY_ID.get(group)
  if (!g?.connection) return true
  return connected === null || connected.has(g.connection)
}

/**
 * Names of tools to hide from the model this round. `allToolNames` is the
 * static catalog; MCP tools are never hidden here.
 */
export function hiddenToolNames(opts: {
  entries: TranscriptEntry[]
  allToolNames: string[]
  connected: Set<ConnectionProvider> | null
  mode?: ToolLoadingMode
}): string[] {
  const mode = opts.mode ?? 'smart'
  if (mode === 'all') return []
  const active = activeToolGroups(opts.entries)
  const hidden: string[] = []
  for (const name of opts.allToolNames) {
    const g = groupOfTool(name)
    if (!g) continue
    const on = active.has(g.id) && isGroupAvailable(g.id, opts.connected)
    if (!on) hidden.push(name)
  }
  return hidden
}

export function describeToolGroup(id: ToolGroupId): string {
  return GROUP_BY_ID.get(id)?.summary || id
}

export function connectionForGroup(id: ToolGroupId): ConnectionProvider | undefined {
  return GROUP_BY_ID.get(id)?.connection
}

export function parseToolLoadingMode(raw: unknown): ToolLoadingMode {
  return raw === 'all' ? 'all' : 'smart'
}

export function parseToolGroupArgs(raw: unknown): ToolGroupId[] {
  return [...new Set(groupsFromArg(raw))]
}

export function __resetToolsetsForTests(): void {
  connectedCache = null
  connectedFetchedAt = 0
}
