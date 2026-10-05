# Pawn — Agent guide

> **Audience:** coding agents (and maintainers) that install, configure, debug, or extend Pawn.
> **Humans:** [README](../../README.md).
> **Locales:** [한국어](./GUIDE.ko.md) · [中文](./GUIDE.zh.md) · [日本語](./GUIDE.ja.md)

When a user pastes this repo and asks for a change, read this file, then change only what they asked for.

---

## 1. Product

Desktop agent. Electron + React + TypeScript. BYOK: any OpenAI- or Claude-compatible API. Local data under `~/.pawn`. UI languages: en, ko, ja, zh.

- Skills, plugins, MCP, and hooks are user-installed. The built-in tool list is the product surface.
- Claude Code layout is read in place: `CLAUDE.md`, `AGENTS.md`, `.claude/skills`, `.claude/rules`, `~/.agents/`, Claude `settings.json` hooks, `.mcp.json`.
- Composer placeholder (`chat.placeholder` in `src/renderer/src/i18n/locales/*.json`) is one invitation sentence. Leave `/`, `@`, and `$` out of it. Those characters open menus when typed: `/` commands and skills, `@` files and folders, `$` gambits at the start of the draft only (`$ulw`). Visible controls are attach, record (macOS), Plan/Build, the permission pill, the model chip, and send.

## 2. Install

```bash
npx @parkjangwon/pawn
# or
npm install -g @parkjangwon/pawn && pawn
```

Releases: https://github.com/parkjangwon/pawn/releases/latest

| OS | Artifact |
|----|----------|
| macOS | `pawn-<version>-universal.dmg`. Unsigned: right-click → Open once. |
| Windows | `pawn-<version>-x64-setup.exe`, `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-{x64,arm64}.AppImage` and `.deb` |

Installer cache: `~/.pawn/installers/`. In-app check: Settings → System. Node to build from source: `^20.19.0 || >=22.12.0`.

## 3. `~/.pawn`

| Path | Contents |
|------|----------|
| `pawn.db` | Projects, sessions, messages, transcripts, usage, routines. WAL. Transcripts stay separate from UI messages so prompt-cache prefixes hold. |
| `memory.db` | Long-term memory. FTS5 + local hash embeddings. |
| `hooks.json` / `hooks-settings.json` | User hooks, and the master switch. |
| `mods-settings.json` | Mods master switch, versioned consent, disabled plugins, plugin directories, run order (`pluginOrder`). See [MODS.md](./MODS.md). |
| `mods/` | User-installed Claude Code–compatible mods. |
| `config.toml` | App settings. |
| `mcp.json` | Pawn-managed MCP servers. |
| `decision.json` | Decision-model provider. Keys sealed with `safeStorage`, file mode `0600`. |
| `kiro.json` | Kiro credentials, sealed. |
| `index/` | Local code index (BM25 + dense). |
| `outputs/` | Offloaded tool output, 7 days. Read back with `read_output`. |
| `profiles/` | Learned per-repo commands and gotchas. |
| `reports/` | Automation deliverables. |
| `telegram.json` | Telegram bot token (sealed), pairing allowlist, chat bindings. Mode `0600`. |

## 4. Loop, modes, permissions

Main loop is in `src/renderer/src/stores/chatLoop.ts`. One user message runs until a final answer, a permission stop, or the round cap.

| Knob | Values |
|------|--------|
| Agent mode | `plan` (mutating tools hidden and refused) · `build` (full surface; permissions still apply). `app_set_agent_mode`. |
| Permission | `ask` · `auto` · `yolo`. Per-tool class in `src/renderer/src/agent/toolPermission.ts`. |
| Harness | `default` (50 rounds, 6 tasks/parallel call) · `eco` (25 rounds, tier ceiling `mid`, 3 tasks, pool 2) · `maxing` (80 rounds, 12 tasks, pool 8, prefer stronger same-tier models). Does not bypass permissions, Plan, or spend caps, and does not touch skills, MCP, or hooks. An explicit reasoning choice beats the mode. |
| Ultra Work | `$ulw` / `$ultrawork` at the start of a message, or `pawn-headless --ulw`. Loops until the goal is verified. A `$` later in the text (`$5`, `$HOME`) is not a gambit. |
| Tool diet | ~130 schemas. Core tools stay on. Optional groups load when the transcript already used them, the user text matches the group's keywords, or the model calls `load_tools`. Account groups stay hidden until that account is connected. Setting: smart (default) or all. |
| Stuck | Repeated identical calls, edit thrash, or errors climb a ladder: reflect → stronger model → second opinion → rollback suggestion → stop and ask. |
| Verify ladder | After file edits, Settings → Agent's done-gate (typecheck/test) runs once without a model round: auto/yolo silently, ask mode asks once via a question card. Failures go back to the model; **two consecutive failed rounds bump the fix round one model tier**. |
| Planning nudge | When routing judges a task `complex` and the session has no plan, the loop asks for an `update_plan` scaffold before edits (soft instruction, Plan Strip shows progress). |
| Visual verify | When a turn edits web UI files (html/css/jsx/tsx/vue/svelte…), the loop adds a one-shot instruction: screenshot the running dev server and read `browser_console` before finishing. Uses the model's own browser tools; skipped when it has none. |
| Git checkpoint | Before the first file-mutating tool of a turn in a local git repo, the harness records `git stash create` + `store` (working tree untouched). A failed attempt is disposable via `git stash list`. |
| Streaming | Read-only tools may start while the model is still streaming. Bulky results are offloaded, then cleared oldest-first before a full compaction. |

Subagent hard max is 25 rounds. `parallel_agents` accepts up to the harness task cap (default 6).

## 5. Tools

Names are the contract. Schemas live in `src/renderer/src/agent/toolDefs/`.

**Files, git, shell** (core): `read_file` `write_file` `edit_file` `delete_file` `list_dir` `search_files` `grep_search` `read_spreadsheet` · `git_status` `git_diff` `git_log` `git_add` `git_commit` `git_push` `git_branch` `git_stash` `git_pr_ready` · `shell_exec` `shell_poll` `shell_kill` `shell_wait` `terminal_list` `terminal_read`.

**Code intelligence** (core, except the refactor group): `codebase_search` `semantic_search` `affected_tests` `repo_map` `run_checks` `issue_to_pr` · `lsp_diagnostics` `lsp_definition` `lsp_references` `lsp_hover` · refactor group: `lsp_symbols` `lsp_call_hierarchy` `lsp_code_actions` `lsp_apply_code_action` · `lsp_rename` stays available for semantic rename.

**Endurance** (`workspace` group): `working_notes` `checkpoint_mark` `checkpoint_restore` `project_profile` · `read_output` is core.

**Agent** (core): `update_plan` `ask_user` `request_plan_approval` `load_tools` `load_skill` `install_skill` `write_artifact` `list_artifacts` · `save_skill` is the `skills` group.

**Web** (core, public pages, no extra key): `web_search` (DDG HTML + HN + Wikipedia) `web_fetch` (platform API → header grid → Jina) `web_research`. Fetched text is untrusted. SSRF blocks private and loopback hosts. `must_invoke_browser` means switch to `browser_*`. Adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT).

**Browser** (group `browser`): embedded Chromium, own cookie jar. `browser_navigate` `browser_snapshot` `browser_click` `browser_fill` `browser_select` `browser_read_text` `browser_eval` `browser_scroll` `browser_back` `browser_wait` `browser_screenshot` `browser_open_external` · tabs: `browser_tab_new` `browser_tab_list` `browser_tab_switch` `browser_tab_close` · `browser_console` `browser_network`. The agent, the UI panel, and each subagent get their own tab.

**Computer** (group `computer`): `computer_screenshot` `computer_zoom` `computer_ui_snapshot` `computer_ui_action` `computer_find` `computer_ocr` `computer_apps` `computer_windows` `computer_menu` `computer_open` `computer_click` `computer_mouse` `computer_drag` `computer_scroll` `computer_type` `computer_key` `computer_hold_key` `computer_clipboard` `computer_wait` `computer_displays` `computer_status`.

**Debug** (group `debug`): `debug_start` `debug_breakpoints` `debug_control` `debug_eval` `debug_stop`. Node inspector, debugpy, delve, lldb-dap.

**Memory** (core): `memory_search` `memory_save` `memory_list` `memory_update` `memory_forget` `memory_consolidate`. Auto-capture after turns. Injected matches are untrusted data. Scopes: user / project. Secrets are rejected on save. UI: Settings → Agent → Memory.

**Decision** (core, hidden while no provider is active): `decide`. Up to 32 typed questions per call.

**App** (group `app`; `app_set_agent_mode` stays core): `app_open_tab` `app_close_tab` `app_set_model` `app_set_permission_mode` `app_set_reasoning` `app_toggle_theme` `app_list_automations` `app_create_automation`.

**Subagents** (core): `spawn_agent` `parallel_agents` `list_agents` `await_agent` `cancel_agent` `research_report`.

**Model-native tools** (Settings → Agent, on by default): Claude 4+ on the Anthropic API gets `str_replace_based_edit_tool` and a persistent `bash` instead of `read_file` / `write_file` / `edit_file`. GPT-4.1 / GPT-5 / o3 / o4 / Codex get `apply_patch` instead of `edit_file` / `write_file`. Same undo ledger, stale-write check, permissions, and Plan gate. Claude on the Anthropic API can also receive its native computer tool (`computer_20251124` and siblings; same settings page).

`load_tools` groups: `browser` `computer` `debug` `refactor` `workspace` `github` `gitlab` `google` `codecommit` `app` `skills`.

## 6. Subagents and research

`spawn_agent` profiles: `explore` and `plan` (read-only), `worker` (implements; default isolation `worktree`, apply `auto`), `code-reviewer` (read-only). Custom profiles: `.pawn/agents/` or `.claude/agents/`. `background: true` returns a run id; `await_agent` / `cancel_agent` take an id, a name, or `*`.

`parallel_agents` runs independent tasks concurrently and orders the rest with `depends_on`. Failed dependencies skip their dependents unless `on_dependency_fail` says otherwise.

`research_report` plans the topic, runs parallel workers (each in its own tab, mixing `web_*` and `browser_*`), dedups sources, then a synthesizer with only read tools plus `write_artifact` writes the report. That synthesizer profile stays narrow even if a project agent file would widen it.

## 7. Skills, hooks, mods, MCP

| Skills | Where |
|--------|--------|
| Ask in chat | Git URL → `install_skill` (`user` default, or `project`) |
| User | `~/.agents/skills/<name>/SKILL.md`, `~/.claude/skills/` |
| Project | `<project>/.claude/skills/`, `skills/`, `.agent/skills/` |
| Plugins | `.claude/plugins/` plus `installed_plugins.json` |
| Write from the agent | `save_skill` → `~/.agents/skills`. Refused in Plan. |

A skill is a catalog line until `load_skill`. Also loaded: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md`, Codex `.agent/`, `~/.agents/AGENTS.md`. UI: Settings → Plugins.

### Settings hooks (shell / HTTP)

Hooks merge across sources. Same command or URL is deduped. A `PreToolUse` deny still denies in `yolo`.

| Source | Path |
|--------|------|
| Claude user | `~/.claude/settings.json` → `hooks` |
| Claude project | `<project>/.claude/settings.json` → `hooks` |
| Pawn user | `~/.pawn/hooks.json` |
| Pawn project | `<project>/.pawn/hooks.json` |

Events: `SessionStart`, `UserPromptSubmit` (may block), `PreToolUse` (may deny), `PermissionRequest`, `PostToolUse` (advisory), `Stop`. Handler `type` is `command` (stdin JSON) or `http` (POST JSON). Matchers accept Claude aliases (`Bash` → `shell_exec`, `Write` / `Edit` → write/edit). UI: Settings → Hooks. Hooks run in the main process only.

### Mods (Claude Code–compatible)

A mod is a plugin with `hooks/hooks.json` → `modules`. It exports `register(on)` and runs in the agent process. It is not a settings hook. Full authoring, consent, events, UI, and the `$` API: **[MODS.md](./MODS.md)**.

| Piece | Path / note |
|-------|-------------|
| Manifest | `.claude-plugin/plugin.json` (or `.pawn-plugin/plugin.json`) |
| Hooks manifest | `hooks/hooks.json` with `"modules": ["./register.js"]` |
| Install | `~/.pawn/mods/<name>/`, extra folders, project `.claude/plugins/`, Claude installs only if scan is on |
| Settings | `~/.pawn/mods-settings.json`. Consent is `{ name, version }`. `pluginOrder` is run order within a tier. A new version needs review again. |
| Sample | `examples/mods/first-mod/` |

UI: Settings → Plugins → Mods. Chat shows a chip and an intervention log. The chip menu lists a conflict for any event two mods both listen to, and can reorder them. The log records a conflict when `tool.call` or `prompt.submit` runs that way. Each `AbovePrompt` mod gets its own band. Events, consent, and the `$` API: [MODS.md](./MODS.md). `tool.call` runs before settings `PreToolUse`. Turning mods off does not unload skills or MCP.

MCP discovery, stdio, first match wins on id collision with project overriding user:

1. `~/.claude.json`
2. `<project>/.mcp.json`
3. `~/.pawn/mcp.json`

UI: Settings → MCP. `user-claude` entries are read-only; Pawn does not write Claude Code's file.

## 8. Record and replay (macOS)

One demonstration becomes a `SKILL.md`. Replay uses `browser_*`, `computer_*`, and MCP. Steps are intent and visible labels, never coordinates.

- Start: composer record button, `/record`, command palette, or the menu bar. Setup asks for the goal, which inputs change per run, and the source: Pawn browser (isolated-world script, element name/role/label, `isTrusted` events) and/or Mac apps (`pawn-cua` ≥ 1.1.0).
- Stop: recording bar, menu bar, or Esc twice. Caps: 30 min / 3000 events. A red pill stays on screen.
- Privacy: password, OTP, card, and macOS secure fields are stored as "secret value, not recorded". Pawn's own windows and the agent's synthetic input are ignored. The raw recording (events + up to 8 screenshots) stays in memory, goes to the chat model once to draft the skill, then is dropped.
- Card actions: Save (`~/.agents/skills`, asks before replace), Run (fills `/<name>` plus inputs), Automate, Refine (`save_skill`). A failed draft stays in memory for Try again until discard or quit.

Code: `src/main/recorder/*`, `src/main/ipc/recorder.ts`, `native/macos/pawn-cua/Recorder.swift`, `src/renderer/src/stores/recording.ts`, `src/renderer/src/agent/recordReplay.ts`, `src/renderer/src/agent/skillDrafting.ts`.

## 9. Providers, routing, decisions

Presets include Kiro, OpenAI, Anthropic, OpenRouter, DeepSeek, OpenCode Go (`https://opencode.ai/zen/go/v1`), Command Code (`https://api.commandcode.ai/provider/v1`), Xiaomi MiMo (`https://api.xiaomimimo.com/v1`, OpenAI + Anthropic paths), Gemini, xAI, Groq, Moonshot, Ollama, LM Studio, plus any custom OpenAI- or Claude-compatible base URL.

- **Subscription sign-in** (Settings → Providers): ChatGPT (Plus, Pro, Team, Enterprise; device code; usage on that subscription; API keys stay on the OpenAI preset), Claude (Pro, Max, Team, Enterprise, or a console API key; a signed-in session is used for `api.anthropic.com` until sign-out), xAI (SuperGrok or X Premium+ device code; the console API key is used while signed out), Antigravity (the Google account used for Antigravity; API keys stay on the Gemini preset). Refresh tokens stay encrypted under `~/.pawn`.
- **Sync models** calls `GET {baseUrl}/models`. Seed models are only a bootstrap. Test uses a model already attached to that provider.
- Keys use OS `safeStorage` when it is available.
- Router: complexity `simple|medium|complex`, cache stickiness, escalate after tool failures, provider cooldown 5s–120s, vision fallback when the turn has images. DeepSeek and MiMo thinking tool-loops must echo `reasoning_content` (empty string if none).
- **Kiro** (`apiFormat: kiro`, `src/main/kiro/*`): AWS Builder ID / IAM Identity Center device flow, a Kiro API key (`ksk_`), or a read-only import of the Kiro CLI / IDE login (Pawn does not refresh that login). Chat is `GenerateAssistantResponse`. Unofficial protocol. Headless: `KIRO_API_KEY` or the CLI login. Live test: `PAWN_KIRO_E2E=1`.

Decision models (Settings → Decision models, `src/main/decision/*`). One active provider. Nothing changes when none is set. Transport is main-process only, official `@typesafe-ai/sdk`, secrets redacted.

| Provider | Notes |
|----------|--------|
| TypeSafe (Jev) | `https://api.typesafe.ai`, key required, default model `jev-latest`. |
| Ollaya | Open models (Laya, Winnow, …) at `http://localhost:11435`. No key unless `OLLAYA_API_KEY`. |
| Custom | Any TypeSafe-compatible `/v1/systemone`. |

Switches, each fails open: `decide` (default on); shell risk check (default on) sends an auto-approved `shell_exec` back to the user when it looks destructive (`≥ 0.5`) or exfiltrating (`≥ 0.8`); router assist (default off, key `routerAssist`) may label a turn's complexity when p ≥ 0.5. Headless reads `~/.pawn/decision.json`. Keys: `TYPESAFE_API_KEY` / `OLLAYA_API_KEY` / `PAWN_DECISION_API_KEY`.

## 10. Connections

Settings → Connections. Tokens stay under `~/.pawn`.

| Provider | Auth | Tools |
|----------|------|--------|
| GitHub | OAuth | `github_whoami` `list_repos` `get_repo` `list_issues` `get_issue` `list_pulls` `get_pull` `review_pull` `list_commits` `get_file` `search_code` `search_issues` `create_issue` `draft_issue` `comment` `create_pull` |
| GitLab | PAT + base URL | `gitlab_whoami` `list_projects` `get_project` `list_issues` `get_issue` `list_merge_requests` `get_merge_request` `list_commits` `get_file` `search` `create_issue` `comment` `create_merge_request` |
| Google | OAuth, read by default | `google_whoami` `drive_search` `drive_read` `gmail_search` `gmail_read` `calendar_list` `tasks_list` `sheets_read` `docs_read` `slides_read`. After a reconnect that grants write scopes: `google_gmail_send` `google_sheets_write` `google_calendar_create`. Confirm with the user before send or create. |
| CodeCommit | IAM keys | `codecommit_whoami` `list_repos` `get_repo` `list_branches` `get_branch` `list_commits` `get_file` |

Desktop OAuth client IDs (Google, GitHub) are injected at release. See [.github/OAUTH_SECRETS.md](../../.github/OAUTH_SECRETS.md) and [PRIVACY.md](../../PRIVACY.md).

## 11. Telegram

Settings → Telegram. A private bot controls this desktop agent from a direct message. Long polling (no public webhook), same shape as OpenClaw and Hermes. The token stays in the main process.

- Unknown senders receive a pairing code and no agent turn. Approve or deny the code in Settings, or add a numeric user id by hand there to skip the code. Group chats are ignored. Bot copy follows each user's Telegram client language (with the app language as fallback).
- Paired messages run in the project chosen there, as a sidebar chat that does not take focus. Commands follow agent conventions: `/plan [request]` switches the session to plan mode and runs the request (or refreshes the task plan) read-only, `/build` returns to build mode, `/tasks` shows the chat's task list. Also `/new` fresh chat, `/stop` cancel, `/sessions` + `/chat <n>` switch chats, `/changes` lists file changes with `/undo <n>` to revert one set (never clobbering later edits), `/model` shows the model and context fill, `/compact` shrinks the context, `/project` the folder, `/usage` the last day's spend, and `/help` `/status` `/whoami` stay on the bot.
- `ask` permission prompts are forwarded to that chat as Allow / Deny buttons. The desktop dialog still works.
- A second poller (HTTP 409) is retried, then the gateway stops. Quit Pawn and the bot stops. On every successful start the command list and the chat menu button are registered with Telegram, so the client offers autocomplete when typing `/`.

Code: `src/main/telegram/*`, `src/main/ipc/telegram.ts`, `src/renderer/src/stores/telegramBridge.ts`.

## 12. Remote execution (SSH)

Settings → Remote execution. A project can run its commands on another machine you reach with SSH — Tailscale MagicDNS hostnames work as plain hostnames. The agent loop, your API keys, and this app stay on this computer; only tool execution ships over an ssh channel.

- Add hosts in Settings (label, user@host, port, optional identity file). Password auth is supported through the `sshpass` helper; the password is sealed with the OS keychain and never crosses IPC. Host keys are trusted on first use (`accept-new`).
- Pick the execution target per project plus the absolute repo path on that host. Shell tools, git, run checks, persistent bash sessions, and background jobs run there. The tool row shows a host chip when a command ran remotely.
- Local-only tools (read/write/edit_file, text_editor, apply_patch, grep/semantic/codebase_search, LSP, debugger, worktrees) are refused on remote projects — use shell tools (`cat`, `tee`, `sed`) instead. This is deliberate: they would silently touch the wrong machine.
- The host list is the main process's source of truth: execution requests only honor configured host ids, and the dangerous-command denylist still applies before anything ships over ssh.
- Abort and timeout kill the local ssh process, which tears the channel down (the remote command receives SIGHUP). ControlMaster multiplexes connections per user@host:port for speed.

Code: `src/main/ssh.ts`, `src/main/ipc/ssh.ts`, `src/renderer/src/agent/executionTarget.ts`.

## 13. Computer use

macOS uses the bundled helper `pawn-cua` (Swift: ScreenCaptureKit, CGEvent, Accessibility, Vision). No Homebrew package. Grant Accessibility and Screen Recording (Settings → Agent → Computer use → Check). Esc twice stops. Coordinates are pixels of the latest screenshot and are multi-monitor aware. `return_screenshot` can ride on an action. Typing is IME-safe; long text is pasted.

Windows and Linux: mouse, keyboard, screenshot, clipboard via PowerShell / `xdotool`.

Headless: `pawn-headless run --computer "…"`.

## 14. Headless

`npm run headless` builds `out/headless/pawn-headless.mjs`.

```text
pawn-headless run "<prompt>" [--cwd DIR] [--mode default|eco|maxing]
    [--model ID] [--permission auto|yolo|deny] [--plan] [--json]
    [--ulw] [--max-iterations N] [--computer] [--config FILE]
pawn-headless eval [--tasks ids,tags] [--modes a,b] [--models id,id]
    [--repeat N] [--out report.md] [--json-out report.json] [--keep]
pawn-headless tasks
```

`--permission deny` maps to `ask`. Config default is `~/.pawn/config.toml`. Keys: `PAWN_API_KEY_<PROVIDER_ID>` or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`.

## 15. Security invariants

- Renderer: `nodeIntegration: false`, `contextIsolation: true`. System calls go through `src/main/ipc/*` and `src/preload/index.ts` (`contextBridge`).
- Memory and fetched web text are untrusted data, not instructions.
- `PreToolUse` / `PermissionRequest` deny is enforced in `yolo`.
- Research SSRF guards stay on. Secrets are not written to memory or recordings.
- The Telegram bot token never reaches the renderer. DMs stay denied until a pairing code is approved on this computer.

## 16. Develop

```bash
npm install
npm run dev          # Electron + Vite HMR
npm run dev:web      # renderer only, 127.0.0.1:5173
npm run typecheck
npm run test
npm run check        # typecheck + test + build
npm run dist         # current OS → release/
npm run dist:mac | dist:win | dist:linux
npm run pack
```

Release builds are unsigned unless `CSC_LINK` / `CSC_KEY_PASSWORD` and `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` are set. `build/notarize.cjs` runs only then.

```
src/main/            Electron main, IPC, DB, window
  connections/       OAuth + PAT tools
  memory/  hooks/  computer/  research/  recorder/  kiro/  decision/
  codeIndex/  debug/  lsp/
src/preload/         contextBridge
src/renderer/src/agent/    loop, toolDefs, toolHandlers, router
src/headless/        pawn-headless
native/macos/pawn-cua/
```

Contributor rules: root `CLAUDE.md`. Stack: Electron, React 19, TypeScript, electron-vite, Zustand, i18next, better-sqlite3, MCP SDK, xterm.js, node-pty.

Right panel: Terminal, Files, Git, Diff, Artifacts, Browser. `.md` files in the file viewer toggle between rendered preview and source; relative links resolve from that file's folder. Command palette `Cmd/Ctrl+K`. Automations write `~/.pawn/reports/<name>/`. A project may list several folders; the session path picks the tool cwd.

## 17. Playbook

| Ask | Do |
|-----|----|
| Install | `npx @parkjangwon/pawn`, or the release artifact. macOS Gatekeeper: right-click → Open. |
| Add a provider | Settings → Providers → preset or base URL → Sync models. DeepSeek/MiMo thinking must echo `reasoning_content`. Pair computer use with a vision model. |
| Install a skill | `install_skill` with a git URL, or copy into `~/.agents/skills/<name>/SKILL.md`. |
| Computer use on a Mac | Bundled `pawn-cua`. Grant Accessibility + Screen Recording. Do not install cliclick. |
| MCP | Settings → MCP, or `~/.pawn/mcp.json`, or the project's `.mcp.json`. |
| Hooks | `~/.pawn/hooks.json` or Claude `settings.json`. Merge + dedupe. Deny wins. |
| Memory | Settings → Agent → Memory. DB: `~/.pawn/memory.db`. |
| Connections | Settings → Connections. Google write tools need a reconnect that grants write scopes. |
| Record a workflow | macOS. Record button or `/record` → perform it → Stop → Save. Later `/<skill-name>`. |
| Decision model | Settings → Decision models. TypeSafe key, or `ollaya serve` + `ollaya pull laya`. |
| Headless | `npm run headless`, then `node out/headless/pawn-headless.mjs run "…"`. |
| Long chat feels muddy | Usage popover → "Continue in a fresh chat": starts a new session seeded with a handoff (goal, progress, plan, files touched) built locally, no extra model call. "Compact context now" stays for in-place relief. |
| Trust a risky turn | Every turn in a local git repo gets an automatic `git stash` checkpoint before the first edit — `git stash list` holds the exact pre-edit state. |
| Build | Node version above, `npm install`, `npm run check`. |
| Tool denied | Permission mode, Plan mode, `PreToolUse` deny, disconnected account, tool group not loaded. |
| Measure the agent | `npm run eval` — 13 built-in tasks (bugfix/feature/refactor/runtime/spec) with objective checks and reference solutions; `node out/headless/pawn-headless.mjs tasks` lists them. |

## 18. License

MIT. OAuth privacy: [PRIVACY.md](../../PRIVACY.md).
