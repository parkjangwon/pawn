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

export type ToolGroupId = 'browser' | 'computer' | 'debug' | 'refactor' | 'workspace' | 'github' | 'gitlab' | 'google' | 'codecommit' | 'app'
export type ConnectionProvider = 'github' | 'gitlab' | 'google' | 'codecommit'
export type ToolLoadingMode = 'smart' | 'all'

interface ToolGroup {
  id: ToolGroupId
  /** Tool-name prefix owning the group ('' = members only). */
  prefix: string
  /** Explicit members (tools whose prefix belongs to core, e.g. lsp_*). */
  members?: string[]
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
      /\bscreen(shot)?\b|\bdesktop\b|\bmouse\b|\bkeyboard\b|\bcomputer\b|\bfinder\b|\bdock\b|\bmenu ?bar\b|\b(open|launch|quit) (the )?[a-z][\w.]* app\b|\bmac ?os\b|\bsystem settings\b|\bulw\b|화면|스크린샷|마우스|키보드|데스크톱|바탕화면|컴퓨터|맥에서|앱을? (열|실행)|画面|スクリーンショット|マウス|デスクトップ|コンピュータ|屏幕|截图|鼠标|桌面|电脑/i,
    summary: 'desktop control: screenshot, mouse, keyboard, clipboard'
  },
  {
    id: 'debug',
    prefix: 'debug_',
    keywords:
      /\bdebug(ger|ging)?\b|\bbreakpoints?\b|\bstep (through|into|over)\b|\bstack ?trace\b|\bsegfault\b|\bcore dump\b|\bcrash(es|ing)?\b|\bhangs?\b|\binfinite loop\b|\bwrong (value|result|output)\b|\brace condition\b|디버그|디버깅|브레이크 ?포인트|중단점|크래시|デバッグ|ブレークポイント|调试|断点/i,
    summary: 'debugger: breakpoints, step, inspect variables (Node, Python, Go, C/C++/Rust)'
  },
  {
    id: 'refactor',
    prefix: '',
    members: ['lsp_code_actions', 'lsp_apply_code_action', 'lsp_call_hierarchy', 'lsp_symbols'],
    keywords:
      /\brefactor|\bextract (a |the )?(function|method|constant|variable|component)|\binline\b|organi[sz]e imports|quick ?fix|\bcallers?\b|call (graph|hierarchy|sites?)|who calls|\boutline\b|restructur|리팩|추출|호출하는|호출 ?(계층|관계)|정리해|リファクタ|抽出|呼び出し元|重构|提取|调用(者|关系|层级)/i,
    summary: 'language-server refactoring: code actions / quick fixes, call hierarchy, symbol outline'
  },
  {
    id: 'workspace',
    prefix: '',
    members: ['working_notes', 'checkpoint_mark', 'checkpoint_restore', 'project_profile'],
    keywords:
      /\bmigrat|\bport (it |this |the )?(to|from)\b|\boverhaul|\brewrite\b|\bentire (code ?base|repo|project)|\bwhole (code ?base|repo|project)|\ball (the )?files\b|\bacross the (code ?base|repo)|\bmulti-?step|\blong[- ]running|\bstep by step\b|\bremember\b|\bgotchas?\b|\bcheckpoints?\b|\bulw\b|마이그레|전체 (코드|프로젝트|저장소)|모든 파일|대규모|단계별|기억해|체크포인트|移行|全体|すべてのファイル|迁移|整个(项目|代码)|所有文件/i,
    summary: 'long tasks: working notes, checkpoints (mark / restore), repo profile notes'
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
    if (g.members?.includes(toolName)) return g
  }
  for (const g of TOOL_GROUPS) {
    if (g.prefix && toolName.startsWith(g.prefix)) return g.keepCore?.includes(toolName) ? null : g
  }
  return null
}

/**
 * Transcript events after which the prompt cache is already being rebuilt
 * (compaction, tool-result clearing) — adding the long-task tools then is free.
 */
const LONG_TASK_MARK = /^\[cleared to save context|<working_notes>/

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
        if (tc.toolset === 'computer' || tc.name === 'computer') {
          active.add('computer')
          continue
        }
        if (tc.name === 'load_tools') {
          for (const g of groupsFromArg(tc.arguments.groups)) active.add(g)
          continue
        }
        const g = groupOfTool(tc.name)
        if (g) active.add(g.id)
      }
    } else if (e.role === 'tool') {
      if (!active.has('workspace') && typeof e.content === 'string' && LONG_TASK_MARK.test(e.content)) active.add('workspace')
    } else if (e.role === 'user' || e.role === 'summary') {
      if (e.role === 'summary') active.add('workspace')
      const text = e.content || ''
      for (const g of TOOL_GROUPS) {
        if (active.has(g.id)) continue
        // Summaries list "Tools used: browser_click×3" — count those too.
        if (g.keywords.test(text) || (g.prefix && text.includes(g.prefix)) || g.members?.some((m) => text.includes(m))) active.add(g.id)
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
