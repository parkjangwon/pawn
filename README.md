# Pawn

[한국어 버전 (Korean Version)](./README.ko.md)

AI Coding Agent GUI — Code, Browse, Automate.

A desktop application that combines the best of Cursor's auto mode, ChatGPT's UI, OpenCode's BYOK, and Claude Desktop's browser use. No harness, no lock-in — bring your own keys, install your own plugins, build your own agent.

## Philosophy

- **No harness** — Pure canvas. Users install plugins/skills they need. Built-in tools stay thin capabilities, not a fixed research product pipeline.
- **BYOK** — Register any OpenAI or Claude compatible API endpoint.
- **Auto mode** — Multi-model routing based on task complexity and cache optimization.
- **Open source** — MIT licensed, fully customizable.
- **Claude Code compatible** — Loads `CLAUDE.md`, `AGENTS.md`, `.claude/skills/`, `.claude/rules/`, `.agent/`, and `~/.agents/` directories.
- **MCP-native** — Discovers and connects to your existing Model Context Protocol servers (Claude Code, Cursor, or Pawn-managed) so their tools become available to the agent automatically.

## Installation

Download the latest release for your platform from the [Releases page](https://github.com/parkjangwon/pawn/releases/latest), or run it from your terminal:

### Quick install (recommended)

```bash
npx @parkjangwon/pawn
```

This downloads the matching build for your OS and launches the installer. The installer is cached under `~/.pawn/installers/` and reused on subsequent runs. To install the command globally:

```bash
npm install -g @parkjangwon/pawn
pawn
```

### Manual download

- **macOS** — `Pawn-<version>-universal.dmg` (Apple Silicon + Intel). Open the `.dmg` and drag **Pawn** into Applications.
  - First launch: right-click → **Open**, then confirm in the Gatekeeper dialog (the build is unsigned).
- **Windows** — `Pawn-<version>-x64-setup.exe` (Intel/AMD) or `Pawn-<version>-arm64-setup.exe` (ARM). Double-click to run the installer.

### Installing skills & plugins

- **Ask Pawn** — paste a GitHub URL and say "install this skill" (or use the `install_skill` tool). It clones the repo, detects the layout (`plugin.json`, `skills/`, `root SKILL.md`), and installs into the standard locations.
- **User-global skills** — drop `<name>/SKILL.md` folders into `~/.agents/skills/` or `~/.claude/skills/`.
- **Project skills** — drop them into `<project>/.claude/skills/`, `<project>/skills/`, or `<project>/.agent/skills/`.
- **Plugins** — project-scoped into `<project>/.claude/plugins/`, user-global via Claude Code's plugin install (or `~/.claude/plugins/` with an `installed_plugins.json` entry).
- All installed skills are visible and toggleable in **Settings → Plugins**.

Skills are **catalog entries**: the agent sees a short summary and must call `load_skill` for full instructions. Built-in tools (`web_fetch`, `run_checks`, …) are always in the tool list and do not require a skill install.

### Requirements

- macOS 10.12+ or Windows 10/11
- An OpenAI- or Claude-compatible API key (BYOK)

### Service connections (optional)

Link **Google** and/or **GitHub** in **Settings → Connections**. There is no inbox or Drive UI — the agent uses **built-in chat tools** with tokens stored only on this machine under `~/.pawn` (never sent to a Pawn server).

**Google** (read-only): Drive search/read, Gmail search/read, Calendar, Tasks, Docs, Sheets, Slides.

**GitHub**: repos, issues, PRs (including review packs), commits, files, code/issue search; optional writes (create issue, draft issue, comment, open PR) with confirmation in ask mode.

Example prompts: *“What’s on my calendar this week?”*, *“Summarize unread mail from Alice”*, *“Review PR #12 on parkjangwon/pawn”*, *“Is this branch ready for a PR?”*.

Maintainers: inject Desktop OAuth client IDs at release build time via GitHub Actions secrets — see [.github/OAUTH_SECRETS.md](./.github/OAUTH_SECRETS.md). Privacy policy for OAuth consent: [PRIVACY.md](./PRIVACY.md).

## Features

### Core agent loop

- Tool-calling agent loop (up to 25 rounds per turn).
- Permission system with granular user approval dialogs (per tool type, including MCP tools).
- Queue / Steering send modes.
- Collapsed-by-default tool call output (Claude Code-style folded rows) to keep the transcript readable.
- **Attachments**: images (vision-capable models as real image blocks) and text documents; large pastes become removable chips; double-click lightbox for images.

### Built-in agent tools (no extra plugins)

Thin tools that expand what the agent can do. They are not a separate product UI.

#### Files, shell, git

| Tool | Purpose |
|------|---------|
| `read_file` / `write_file` / `edit_file` / `list_dir` / `delete_file` | Safe local FS |
| `read_spreadsheet` | CSV/TSV/XLSX with hard row/column caps |
| `search_files` / `grep_search` | Path globs and text/regex search |
| `codebase_search` | Symbol-aware local search (definitions first, then references) |
| `shell_exec` / `shell_poll` / `shell_kill` | Local shell; background jobs supported |
| `git_status` / `git_diff` / `git_log` | Git inspection without raw shell |
| `git_pr_ready` | Branch, status, commits vs base, diff stat, PR checklist |
| `run_checks` | Detect & run typecheck / test / lint (package.json, go, cargo, pytest, …) |
| `write_artifact` / `list_artifacts` | Durable notes/reports under `<project>/artifacts/` |
| `terminal_list` / `terminal_read` | Read recent output from the embedded terminal panel |
| `update_plan` | Session task checklist for multi-step work |

#### Public web (built-in research engine)

No API keys. Public content only — not a login/paywall bypass. Adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT).

| Tool | Purpose |
|------|---------|
| `web_search` | Discover links (DuckDuckGo HTML + Hacker News + Wikipedia) |
| `web_fetch` | Adaptive page reader: platform public APIs → identity/header grid → Jina Reader |
| `web_research` | Discover sources + fetch several pages for a topic |

**vs browser tools:** use `web_*` to **read** public pages; use `browser_*` to **interact** (clicks, forms, logged-in sessions). If `web_fetch` reports `must_invoke_browser`, escalate to the embedded browser.

Platform Phase-0 routes include Reddit, X/Twitter, YouTube, HN, Bluesky, Wikipedia, arXiv, public GitHub, Stack Overflow, npm, PyPI, and more. Fetched text is wrapped as **untrusted public web** content (prompt-injection resistant envelopes).

If you also install an external “insane-search” skill under Claude Code / `~/.agents`, it only loads after `load_skill`. Built-in `web_fetch` remains always available; prefer the built-in tools unless you explicitly want the skill’s Python workflow.

#### Browser & computer

- **Browser Use**: embedded Chromium with its own cookie session — navigate, snapshot, click, fill, read text, screenshot, with a visible AI cursor.
- **Computer Use**: cross-platform desktop automation (screenshot as vision, click/type/keypress).
  - macOS: `cliclick` + AppleScript fallback
  - Windows: PowerShell / `.NET Forms SendKeys`
  - Linux: `xdotool`
  - High-DPI coordinate normalization

#### Google & GitHub (Settings → Connections)

| Area | Tools (summary) |
|------|-----------------|
| Google (read-only) | `google_whoami`, Drive search/read, Gmail search/read, Calendar, Tasks, Docs, Sheets, Slides |
| GitHub (read) | repos, issues, pulls, **`github_review_pull`** (full review pack: patches, checks, checklist), commits, files, code/issue search |
| GitHub (write) | `github_create_issue`, **`github_draft_issue`** (structured draft; `create:true` to open), `github_comment`, `github_create_pull` |

Results appear in chat — no separate mailbox or PR product surface.

#### App control

Open/close right-panel tabs, model/permission/reasoning/theme, list/create automations — via `app_*` tools.

### Model Context Protocol (MCP)

- Discovers stdio MCP servers from `~/.claude.json` (Claude Code), project `.mcp.json`, and Pawn's own `~/.pawn/mcp.json`.
- Discovered tools merge into the agent tool list and route to the correct server on call.
- **Settings → MCP**: add/remove Pawn-managed servers (id, command, args, env), live status and tool counts, enable/disable per server.
- Project-scoped servers override user-scoped ones on id collision; one spawn per project per app session.

### Providers & smart routing

- OpenAI API format (GPT-4o, o1, etc.) and Claude API format (Claude 3.5 Sonnet, etc.).
- Custom endpoints (any OpenAI-compatible API).
- API key authentication.
- **Smart Model Router**:
  - **Complexity heuristics** — `simple` \| `medium` \| `complex` from local signals.
  - **Cache-aware routing** — balances cache write cost vs token savings before mid-session switches.
  - **Automatic escalation** — stronger models after consecutive tool failures or empty replies.
  - **Failover & cooldown** — transient cooldown (5s–120s) on failing providers.
  - **Vision fallback** — image messages route to a vision-capable model when needed.

### Local database & persistence

- **SQLite** (`better-sqlite3`, WAL) for local storage.
- **Schemas**: `projects` & `sessions`, `messages`, `transcripts` (cache-stable history), `usage` (tokens & estimated cost), `routines`.

### Right panel — Terminal, Files, Git, Diff, Artifacts & Browser

- **Terminal**: real shell (xterm.js + `node-pty`); also a Codex-style **bottom terminal** toggle. Agent can `terminal_read` recent buffer text.
- **Files**: project tree + built-in editor.
- **Git**: branch, status, log.
- **Diff**: review every changed file before keeping work.
- **Artifacts**: shelf for agent-produced files (also written via `write_artifact` under `<project>/artifacts/`).
- **Browser**: same embedded browser the agent drives.
- Live git-status chip in the composer (branch + diff stat; branch switch / jump to Git/Diff).

### Automation

- Recurring automations on interval / daily / weekly schedules; headless when all windows are closed.
- **Templates**: daily report, web/price monitor, RSS digest, issue triage, changelog, repo audit.
- **Deliverables**: markdown under `~/.pawn/reports/<name>/` (and artifacts/notifications).
- **Shareable**: export/import automations as JSON.
- **Menu bar / tray**: macOS menu bar and Windows tray; multilingual show/hide/open/quit.

### UI / UX

- ChatGPT-style layout (sidebar + chat), native macOS traffic-light-aware header.
- Composer card with attach button and removable chips.
- **Command palette** (`Cmd/Ctrl+K`).
- **Customizable shortcuts** (Settings → Shortcuts) — palette, terminal, panels, sidebar.
- **Sidebar sessions**: pin, delete sessions/projects; active-stream cleanup on delete.
- **"Open in" launcher**: 25+ editor presets with real app icons.
- Light / Dark theme; responsive layout; rich Markdown + copy; streaming cursor; auto-scroll.
- App version in the bottom-right corner.
- i18n: English, Korean, Japanese, Chinese.

### Extensibility

- Claude Code skill format (`.claude/skills/*/SKILL.md`).
- Codex-compatible `.agent/` directory.
- OpenAI Agents user context (`~/.agents/AGENTS.md`, `~/.agents/skills/`).
- One-shot installs from a GitHub URL (`install_skill`).
- `CLAUDE.md` / `CLAUDE.local.md` and `.claude/rules/*.md`.

### Security

- Context isolation + `contextBridge` (`nodeIntegration: false` in the renderer).
- Content Security Policy (CSP).
- Interactive permission requests for sensitive local operations.
- Research fetch SSRF guards (blocks private/loopback targets by default).
- Sandbox support (configurable).

## Tech stack

- **Electron** — Desktop shell
- **React 19** — UI framework
- **TypeScript** — Type safety
- **Vite** (via electron-vite) — Build tooling
- **Zustand** — State management with persistence
- **i18next** — Internationalization
- **SQLite (better-sqlite3)** — Local database
- **react-markdown** + **rehype-highlight** — Markdown rendering
- **highlight.js** — Code syntax highlighting
- **@modelcontextprotocol/sdk** — MCP client (stdio transport)
- **xterm.js** + **node-pty** — Integrated terminal
- **exceljs** — Local spreadsheet preview for the agent

## Development

```bash
# Install dependencies
npm install

# Run in development (Electron + Vite HMR)
npm run dev

# Run renderer only (browser preview, no Electron)
npm run dev:web

# Build for production
npm run build

# Type check
npm run typecheck

# Unit tests
npm run test

# Full quality check (typecheck + test + build)
npm run check
```

## Packaging

```bash
# Build distributable for current platform
npm run dist

# Platform-specific
npm run dist:mac    # macOS (.dmg)
npm run dist:win    # Windows (.exe NSIS installer)
npm run dist:linux  # Linux (.AppImage, .deb)

# Quick pack (no installer, just directory)
npm run pack
```

Output goes to the `release/` directory.

## Project structure

```
src/
├── main/              # Electron main process (IPC, DB, CSP, window management)
│   ├── connections/   # Google/GitHub OAuth (local tokens) + API tools
│   ├── research/      # Public-web engine (web_search / web_fetch / web_research)
│   ├── ipc/           # fs, shell, browser, computer, terminal, mcp, connections, research, …
│   ├── spreadsheet.ts # CSV/XLSX read with caps
│   └── mcpManager.ts  # MCP discovery, lifecycle, tool calls
├── preload/           # Context bridge (secure API exposure)
└── renderer/          # React app
    └── src/
        ├── agent/     # Agent loop, tool definitions/executor, routing, transcripts, MCP
        ├── components/# UI (chat, right panel, settings, artifacts, sidebar, …)
        ├── i18n/      # en, ko, ja, zh
        ├── stores/    # Zustand (app, chat, provider, artifacts, mcp, keybindings, …)
        ├── styles/    # Global CSS + theme tokens
        └── types/     # TypeScript definitions
```

## License

MIT — see [LICENSE](./LICENSE). Privacy practices for optional OAuth: [PRIVACY.md](./PRIVACY.md).

Public-web research engine adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT, © 2026 fivetaku).
