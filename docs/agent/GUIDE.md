# Pawn — Agent Maintenance Guide

> **Audience:** coding agents (and maintainers) that install, configure, debug, or extend Pawn.  
> **Humans:** start at the root [README](../../README.md).  
> **Locales:** [한국어](./GUIDE.ko.md) · [中文](./GUIDE.zh.md) · [日本語](./GUIDE.ja.md)

When a user pastes this repository URL and asks you to set something up, **read this file first**, then change only what they asked for.

---

## 1. What Pawn is

Desktop **AI coding agent** (Electron + React). BYOK: any OpenAI- or Claude-compatible API. Local-first data under `~/.pawn`. No cloud harness.

Philosophy:

- **No harness** — thin built-in tools + user-installed skills/plugins; not a fixed research product pipeline
- **BYOK** — register any compatible endpoint
- **Auto mode** — multi-model routing by complexity + cache stickiness
- **Local Memory** — `~/.pawn/memory.db` only; never a Pawn cloud
- **Hooks** — Claude/Codex-compatible; Claude + Pawn sources **merge** with command/url **dedupe**; **deny wins** over YOLO
- **Claude Code compatible** — `CLAUDE.md`, `AGENTS.md`, skills, rules, `~/.agents/`, Claude `settings.json` hooks
- **MCP-native** — discovers Claude Code / Cursor / Pawn MCP servers

---

## 2. Install & launch (for users)

```bash
npx @parkjangwon/pawn
# or
npm install -g @parkjangwon/pawn && pawn
```

Releases: https://github.com/parkjangwon/pawn/releases/latest

| OS | Artifact | Notes |
|----|----------|--------|
| macOS | `Pawn-*-universal.dmg` | Unsigned: right-click → Open first time |
| Windows | `*-x64-setup.exe` / `*-arm64-setup.exe` | |
| Linux | `.AppImage` / `.deb` | or `npm run dist:linux` |

**Requirements:** macOS 10.12+ / Win 10+ / Linux; Node `^20.19.0 || >=22.12.0` if building from source; API key (BYOK).

Installer cache: `~/.pawn/installers/`.

---

## 3. Skills & plugins

| Method | How |
|--------|-----|
| Ask the agent | GitHub URL + “install this skill” → `install_skill` |
| User-global skills | `~/.agents/skills/<name>/SKILL.md` or `~/.claude/skills/` |
| Project skills | `<project>/.claude/skills/`, `skills/`, `.agent/skills/` |
| Plugins | Project: `.claude/plugins/`; user: Claude Code or `~/.claude/plugins/` + `installed_plugins.json` |
| UI | **Settings → Plugins** (toggle catalog) |

Skills are **catalog entries**: short summary in context; full text via `load_skill`. Built-in tools (`web_fetch`, `memory_search`, `run_checks`, …) are always available without install.

Also loaded: `CLAUDE.md` / `CLAUDE.local.md`, `.claude/rules/*.md`, Codex `.agent/`, `~/.agents/AGENTS.md`.

---

## 4. Local data (`~/.pawn`)

| Path | Purpose |
|------|---------|
| `~/.pawn/pawn.db` | Projects, sessions, messages, transcripts, usage, routines |
| `~/.pawn/memory.db` | Long-term Memory cards (FTS5 + local hash embeddings) |
| `~/.pawn/hooks.json` | Pawn user lifecycle hooks |
| `~/.pawn/hooks-settings.json` | Hooks master switch / source toggles |
| `~/.pawn/config.toml` | App settings (incl. quit confirmation) |
| `~/.pawn/mcp.json` | Pawn-managed MCP servers |
| `~/.pawn/reports/` | Automation deliverables |
| `~/.pawn/installers/` | Cached install packages |

SQLite WAL (`better-sqlite3`). **Transcripts** stay separate from UI messages for prompt-cache stability.

---

## 5. Built-in tools (reference)

Agent loop: up to **50** tool rounds/turn; identical-call loop break. Permissions per tool type (incl. MCP). Queue / steering send modes.

### 5.1 Files, shell, git

| Tool | Purpose |
|------|---------|
| `read_file` / `write_file` / `edit_file` / `list_dir` / `delete_file` | Safe local FS |
| `read_spreadsheet` | CSV/TSV/XLSX with hard caps |
| `search_files` / `grep_search` | Globs and regex |
| `codebase_search` | Symbol-aware (defs then refs) |
| `shell_exec` / `shell_poll` / `shell_kill` | Local shell; background jobs |
| `git_status` / `git_diff` / `git_log` | Git without raw shell |
| `git_pr_ready` | Branch readiness + PR checklist |
| `run_checks` | typecheck / test / lint detection |
| `write_artifact` / `list_artifacts` | `<project>/artifacts/` |
| `terminal_list` / `terminal_read` | Embedded terminal buffer |
| `update_plan` | Session checklist |

### 5.2 Lifecycle hooks

Sources **merge** (not replace); **command/url dedupe**:

| Source | Path |
|--------|------|
| Claude user | `~/.claude/settings.json` → `hooks` |
| Claude project | `<project>/.claude/settings.json` → `hooks` |
| Pawn user | `~/.pawn/hooks.json` |
| Pawn project | `<project>/.pawn/hooks.json` |

| Event | When |
|-------|------|
| `SessionStart` | First turn of empty transcript |
| `UserPromptSubmit` | Each user message (can block) |
| `PreToolUse` | Before tool (can deny even in YOLO) |
| `PermissionRequest` | Before Ask dialog |
| `PostToolUse` | After tool (advisory) |
| `Stop` | End of completed turn |

Handlers: `type: "command"` (stdin JSON) or `type: "http"` (POST JSON). Matchers accept Claude aliases (`Bash` → `shell_exec`, `Write`/`Edit` → write/edit). UI: **Settings → Agent → Hooks**.

### 5.3 Long-term Memory

| Tool | Purpose |
|------|---------|
| `memory_search` | Hybrid FTS + local embeddings |
| `memory_save` | Save durable card |
| `memory_list` | Browse / filter |
| `memory_update` / `memory_forget` | Correct / delete |

- Auto-capture after turns; inject top matches as **untrusted** preamble (not instructions)
- UI: **Settings → Agent → Memory** — on/off, export/import/clear, list (search/pin/forget)
- Scopes: **user** / **project**; secrets redacted/rejected on save
- DB: `~/.pawn/memory.db` only

### 5.4 Public web (no extra API keys)

Adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT). Not a login/paywall bypass.

| Tool | Purpose |
|------|---------|
| `web_search` | DDG HTML + HN + Wikipedia |
| `web_fetch` | Platform APIs → header grid → Jina Reader |
| `web_research` | Multi-page topic research |

**vs browser:** `web_*` = read public pages; `browser_*` = interact / logged-in. If `web_fetch` returns `must_invoke_browser`, escalate.

SSRF guards block private/loopback by default. Fetched text wrapped as untrusted public web.

### 5.5 Browser & computer use

**Browser** (`browser_*`): embedded Chromium, own cookies — navigate, snapshot, click, fill, screenshot, AI cursor.

**Computer** (`computer_*`) — full desktop OS:

| Tool | Purpose |
|------|---------|
| `computer_screenshot` | Vision capture + size meta (`display_id`) |
| `computer_displays` | List monitors |
| `computer_click` | Buttons, single/double; image or screen coords |
| `computer_move` / `computer_drag` / `computer_scroll` | Pointer |
| `computer_type` / `computer_keypress` | Text + hotkeys (`cmd+c`, …) |
| `computer_clipboard` | Get/set text |
| `computer_wait` | UI settle |

- Default coord space: **image** from last screenshot; optional `return_screenshot`
- **macOS:** `brew install cliclick` + Accessibility + Screen Recording
- **Windows:** PowerShell mouse/keyboard APIs
- **Linux:** `xdotool`
- Prefer vision-capable model (or router vision fallback) for screenshots

### 5.6 Google & GitHub (Settings → Connections)

Tokens only under `~/.pawn`. No separate inbox UI — tools in chat.

| Area | Tools (summary) |
|------|-----------------|
| Google (read-only) | Drive, Gmail, Calendar, Tasks, Docs, Sheets, Slides, `google_whoami` |
| GitHub (read) | repos, issues, PRs, **`github_review_pull`**, commits, files, search |
| GitHub (write) | create/draft issue, comment, create PR (confirm in ask mode) |

Maintainers: inject Desktop OAuth client IDs at release via Actions secrets — [.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md). Privacy: [PRIVACY.md](../../PRIVACY.md).

### 5.7 App control & skills

| Tool | Purpose |
|------|---------|
| `app_open_tab` / `app_close_tab` | Right-panel tabs |
| `app_set_model` / `app_set_permission_mode` / `app_set_reasoning` / `app_toggle_theme` | Session UI |
| `app_list_automations` / `app_create_automation` | Automations from chat |
| `load_skill` / `install_skill` | Skill catalog / git install |

---

## 6. MCP

Discovery (stdio):

1. `~/.claude.json` (Claude Code)
2. Project `.mcp.json`
3. `~/.pawn/mcp.json` (Pawn-managed)

Project-scoped overrides user on id collision. UI: **Settings → MCP** (id, command, args, env, enable/disable).

---

## 7. Providers & smart routing

- OpenAI-format and Claude-format APIs; custom OpenAI-compatible endpoints
- **DeepSeek first-class:** presets `deepseek-v4-flash` / `deepseek-v4-pro`; thinking (`thinking` + `reasoning_effort`); stream `reasoning_content`; **must replay `reasoning_content` on every tool-loop request** (empty string if none) or API returns 400. Pair with a vision model for screenshots/computer use
- **Router:** complexity `simple|medium|complex`; cache-aware stickiness; escalate after tool failures; provider cooldown 5s–120s; vision fallback when images present

---

## 8. UI surfaces agents should know

- Right panel: Terminal (xterm + node-pty), Files, Git, Diff, Artifacts, Browser
- Automations: interval/daily/weekly; templates; reports under `~/.pawn/reports/`
- Tray/menu bar; command palette `Cmd/Ctrl+K`; progressive `Cmd/Ctrl+W`; quit confirm `Cmd/Ctrl+Q`
- i18n: en, ko, ja, zh

---

## 9. Security constraints (do not break)

- Renderer: `nodeIntegration: false`, `contextIsolation: true`; system ops only via IPC + `contextBridge` (`src/preload/index.ts`, `src/main/ipc/*`)
- Never put Node/native modules in renderer
- Memory/web inject = untrusted data
- Hooks run in main only; PreToolUse/PermissionRequest **deny** enforced in YOLO
- No secrets in Memory; research SSRF guards on

---

## 10. Develop & package

```bash
npm install
npm run dev          # Electron + Vite HMR
npm run dev:web      # renderer only
npm run build
npm run typecheck
npm run test
npm run check        # typecheck + test + build

npm run dist         # current platform → release/
npm run dist:mac | dist:win | dist:linux
npm run pack         # directory only
```

### Project map

```
src/
├── main/              # Electron main (IPC, DB, window)
│   ├── connections/   # Google/GitHub OAuth + tools
│   ├── memory/        # Memory engine
│   ├── hooks/         # Lifecycle hooks
│   ├── computer/      # Desktop computer-use
│   ├── research/      # web_search / web_fetch / web_research
│   ├── ipc/           # handlers
│   └── mcpManager.ts
├── preload/           # contextBridge
└── renderer/src/
    ├── agent/         # loop, tools, router, transcripts, MCP client
    ├── components/
    ├── stores/        # Zustand
    └── i18n/
```

Product guidelines for contributors: root `CLAUDE.md` / `Claude.md`.

### Tech stack

Electron, React 19, TypeScript, electron-vite, Zustand, i18next, better-sqlite3, MCP SDK, xterm.js + node-pty, exceljs, react-markdown.

---

## 11. Common agent tasks (playbook)

| User ask | What you do |
|----------|-------------|
| Install Pawn | `npx @parkjangwon/pawn` or release DMG/exe; note Gatekeeper on macOS |
| Add API / DeepSeek | Settings → Providers; for DeepSeek ensure thinking + vision fallback |
| Install a skill | `install_skill` with git URL, or copy to `~/.agents/skills/` |
| Enable computer use (macOS) | Install cliclick; grant Accessibility + Screen Recording; use vision model |
| Wire MCP | Edit `~/.pawn/mcp.json` or Settings → MCP; or reuse Claude `.mcp.json` |
| Add hooks | Edit `~/.pawn/hooks.json` or Claude `settings.json` `hooks`; merge rules apply |
| Memory on/off / export | Settings → Agent → Memory; DB at `~/.pawn/memory.db` |
| Connect Google/GitHub | Settings → Connections; tokens in `~/.pawn` only |
| Build from source | Node version + `npm install` + `npm run dev` / `npm run check` |
| Debug tool deny | Check permission mode, Hooks PreToolUse deny, MCP server status |

---

## 12. License

MIT. Privacy for OAuth: [PRIVACY.md](../../PRIVACY.md).
