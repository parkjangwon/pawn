# Pawn

[한국어 버전 (Korean Version)](./README.ko.md)

AI Coding Agent GUI — Code, Browse, Automate.

A desktop application that combines the best of Cursor's auto mode, ChatGPT's UI, OpenCode's BYOK, and Claude Desktop's browser use. No harness, no lock-in — bring your own keys, install your own plugins, build your own agent.

## Philosophy

- **No harness** — Pure canvas. Users install plugins/skills they need.
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

### Requirements

- macOS 10.12+ or Windows 10/11
- An OpenAI- or Claude-compatible API key (BYOK)

### Service connections (optional)

Link **Google** and/or **GitHub** in **Settings → Connections**. There is no inbox or Drive UI — the agent uses **built-in chat tools** with tokens stored only on this machine under `~/.pawn` (never sent to a Pawn server).

**Google** (read-only): Drive search/read, Gmail search/read, Calendar, Tasks, Docs, Sheets, Slides.

**GitHub**: repos, issues, PRs, commits, files, code/issue search; optional writes (create issue, comment, open PR) with confirmation in ask mode.

Example prompts: *“What’s on my calendar this week?”*, *“Summarize unread mail from Alice”*, *“List open PRs on parkjangwon/pawn”*.

Maintainers: inject Desktop OAuth client IDs at release build time via GitHub Actions secrets — see [.github/OAUTH_SECRETS.md](./.github/OAUTH_SECRETS.md). Privacy policy for OAuth consent: [PRIVACY.md](./PRIVACY.md).

## Features

### Core Agent & Tools
- Tool-calling agent loop (up to 25 rounds per turn).
- **File System**: Read, write, edit, list, and delete files safely.
- **Spreadsheets**: `read_spreadsheet` for local CSV/TSV/XLSX with hard row/column caps (safe for large files).
- **Shell execution**: Run CLI tools locally (supports background tasks and standard sandbox modes).
- **Computer Use**: Zero-dependency cross-platform automation:
  - **Multimodal Eyesight**: Feeds screenshots directly to Claude & OpenAI models as image blocks.
  - **macOS Support**: Uses `cliclick` with a robust AppleScript (`osascript`) fallback for typing and hotkeys.
  - **Windows Support**: Zero-dependency PowerShell and `.NET Forms SendKeys` integration.
  - **Linux Support**: Driven via `xdotool`.
  - **High-DPI Normalization**: Normalizes logical coordinate mouse clicks using monitor scale factors.
- **Browser Use**: A real embedded Chromium view with its own persistent cookie session — the agent navigates, clicks, fills forms, reads page text, and takes screenshots via an accessibility-style element snapshot (no brittle CSS selectors required), with a visible AI cursor so you can watch it work.
- **Web research** (built-in): `web_search` (links), `web_fetch` / `web_research` (page text) without a separate API key — Phase 0 platform routes + adaptive fetch grid + Jina. Adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT).
- **Coding loop helpers**: `codebase_search` (symbol-aware), `run_checks` (typecheck/test/lint detection), `git_pr_ready`, `github_review_pull`, `github_draft_issue`, `write_artifact` / `list_artifacts`, `terminal_list` / `terminal_read`.
- **Attachments**: Attach images (sent to vision-capable models as real image blocks) and text documents; pasting a large block of text turns it into a removable chip. Images open in a double-click lightbox.
- **Google / GitHub tools**: optional connected-account tools (see [Service connections](#service-connections-optional)); results appear in chat, not as a separate product surface.
- Permission system with granular user approval dialogs (per tool type, including MCP tools).
- Queue / Steering send modes.
- Collapsed-by-default tool call output (Claude Code-style folded rows) to keep the transcript readable.

### Model Context Protocol (MCP)
- Discovers stdio MCP servers from `~/.claude.json` (Claude Code), project `.mcp.json`, and Pawn's own `~/.pawn/mcp.json` — no need to reconfigure servers you already run for other tools.
- Discovered tools are merged into the agent's tool list automatically and routed to the right server on call.
- **Settings → MCP**: add or remove Pawn-managed servers directly from the UI (id, command, args, env), see live connection status and tool counts per server, and enable/disable individual servers.
- Project-scoped servers override user-scoped ones on id collision; each server is spawned once per project and kept alive for the app session.

### Providers & Smart Routing
- OpenAI API format (GPT-4o, o1, etc.) and Claude API format (Claude 3.5 Sonnet, etc.).
- Custom endpoints (any OpenAI-compatible API).
- API Key authentication.
- **Smart Model Router**:
  - **Complexity Heuristics**: Automatically classifies task complexity (`simple` | `medium` | `complex`) locally based on input size, keywords, and instructions.
  - **Cache-Aware Routing**: Evaluates the cost of cache writes versus per-token savings before switching models to maximize prompt caching performance.
  - **Automatic Escalation**: Automatically escalates to stronger model tiers when detecting consecutive tool failures or empty model responses.
  - **Failover & Cooldown**: Automatically puts failing providers on a transient cooldown (5s to 120s) to keep the agent responsive.
  - **Vision fallback**: when a message includes images, routes to a vision-capable model (or a configured vision fallback) if the current pick cannot handle images.

### Local Database & Persistence
- Powered by **SQLite** (`better-sqlite3` with WAL journal mode) for lightweight, robust local storage.
- **Schemas**:
  - `projects` & `sessions`: Multi-project workspace support.
  - `messages`: Visible chat history.
  - `transcripts`: Byte-stable provider-neutral conversation cache to optimize API prompt caching.
  - `usage`: Tracks detailed usage tokens (input, output, cache-read, cache-write) and estimated costs.
  - `routines`: Recurring scheduled automation routines.

### Right Panel — Terminal, Files, Git, Diff, Artifacts & Browser
- **Terminal**: a real shell (xterm.js + `node-pty`) per project — also available as a Codex-style **bottom terminal** toggle from the chat chrome.
- **Files**: browse the project tree and open/edit files in a built-in editor without leaving Pawn.
- **Git**: branch, status, and log view for the current project.
- **Diff**: review every changed file in one place before deciding what to keep.
- **Artifacts**: shelf of agent-produced files (reports, exports) for quick open/reveal.
- **Browser**: the same embedded browser the agent drives, so you can watch or take over.
- A live git-status chip in the composer bar shows the current branch and diff stat at a glance, with a popover to switch branches or jump straight into the Git/Diff tabs.

### Automation
- Recurring automations on interval / daily / weekly schedules, executed headlessly when every window is closed.
- **Templates**: daily report, web/price monitor, RSS digest, issue triage, changelog, repo audit — one click to create.
- **Deliverables**: finished runs can save markdown under `~/.pawn/reports/<name>/` (and surface paths via notifications / artifacts).
- **Shareable**: export and import automations as a portable JSON file.
- **Menu bar / tray**: macOS menu bar and Windows system tray with the Pawn logo; left- or right-click opens a multilingual menu (show/hide, open, quit).

### UI / UX
- ChatGPT-style layout (sidebar + chat area), with a native macOS traffic-light-aware header — the sidebar toggle sits next to the window controls, and double-clicking anywhere in the header maximizes/restores the window.
- ChatGPT-style composer card: aligned toolbar, attach button, and removable attachment chips.
- **Command palette** (`Cmd/Ctrl+K`) for quick navigation and actions.
- **Customizable keyboard shortcuts** (Settings → Shortcuts) — rebind or reset any binding, including the command palette itself. Toggle terminal / right panel / sidebar from bindings.
- **Sidebar session management**: pin frequently-used sessions, delete sessions or whole projects directly from the Pinned/Recent lists, with active-stream cleanup on delete.
- **"Open in" launcher**: detects installed editors from 25+ presets (VS Code family, Cursor, Windsurf, Trae, Zed, Nova, the full JetBrains suite, Sublime, BBEdit, Xcode, Android Studio, and more) and shows each app's real icon in the menu.
- Light / Dark theme (configurable in Settings > Appearance).
- Responsive layout: Optimized for desktop, tablet, and mobile displays.
- Rich Markdown rendering with syntax highlighting and code block copy utilities.
- Streaming responses with cursor animation.
- Auto-scroll on new messages.
- App version shown in the bottom-right corner.
- Internationalization (i18n): English, Korean, Japanese, and Chinese.

### Extensibility
- Claude Code skill format (`.claude/skills/*/SKILL.md`).
- Codex-compatible `.agent/` directory.
- OpenAI Agents user context (`~/.agents/AGENTS.md`, `~/.agents/skills/`).
- One-shot installs: paste a GitHub URL and ask Pawn to install a skill or plugin — it clones the repo, detects the layout, and installs into the standard `~/.agents/skills` / `~/.claude/plugins` paths.
- `CLAUDE.md` / `CLAUDE.local.md` project context.
- `.claude/rules/*.md` rule files.

### Security
- Context isolation + contextBridge (no nodeIntegration in the renderer).
- Content Security Policy (CSP) headers.
- Interactive permission requests for sensitive local operations.
- Sandbox support (configurable).

## Tech Stack

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

# Full check (typecheck + build)
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

## Project Structure

```
src/
├── main/              # Electron main process (IPC, DB, CSP, window management)
│   ├── connections/   # Google/GitHub OAuth (local tokens) + API tools for the agent
│   ├── research/      # Public-web research engine (web_fetch / web_research)
│   ├── ipc/           # IPC: fs, shell, browser, computer, terminal, mcp, connections, routine, ...
│   ├── spreadsheet.ts # CSV/XLSX read with caps
│   └── mcpManager.ts  # MCP server discovery, lifecycle, and tool calls
├── preload/           # Context bridge (secure API exposure)
└── renderer/          # React app
    └── src/
        ├── agent/     # Agent loop, tools (incl. Google/GitHub), routing, transcripts, MCP bridge
        ├── components/# UI (chat, right panel, settings, artifacts, sidebar, ...)
        ├── i18n/      # Translations (en, ko, ja, zh)
        ├── stores/    # Zustand (app, chat, provider, artifacts, mcp, keybindings, ...)
        ├── styles/    # Global CSS with theme variables
        └── types/     # TypeScript definitions
```

## License

MIT — see [LICENSE](./LICENSE). Privacy practices for optional OAuth: [PRIVACY.md](./PRIVACY.md).

Public-web research engine adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT, © 2026 fivetaku).
