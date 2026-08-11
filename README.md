# Pawn

[한국어](./README.ko.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**Your piece on the board.** A desktop AI coding agent that works for you — code, browse, automate, remember — with your keys, your machine, your rules.

Pawn is not another locked-in cloud IDE. Bring any OpenAI- or Claude-compatible API, install the skills you need, and keep long-term memory and tokens on disk under `~/.pawn`. No harness. No product pipeline you didn’t ask for.

### Why “Pawn”?

In chess, the pawn is the piece that **does the work**: it advances, holds the line, and becomes whatever the game needs. Pawn is that unit for your desktop — humble, local-first, and under *your* control, not a throne you rent from a vendor.

---

## What it can do

- **Code** — File tools, shell, git, symbol search, checks, and a full agent loop with permissions
- **Browse** — Embedded Chromium (`browser_*`) for real web UIs and logged-in sessions. **Multi-tab**: the agent, the UI panel, and every subagent get their own tab (per-owner isolation) and browse in parallel without ever yanking your view
- **Research** — Public web search/fetch without extra API keys (`web_search`, `web_fetch`, `web_research`), plus **`research_report`**: parallel research subagents (each in its own tab) whose findings are deduplicated and synthesized into a citation-checked report artifact
- **Computer use** — Desktop mouse, keyboard, screenshot, and clipboard (`computer_*`)
- **Remember** — Local long-term Memory (`~/.pawn/memory.db`) that personalizes the agent over time
- **Hooks** — Claude/Codex-compatible lifecycle hooks (Claude + Pawn configs merge with dedupe)
- **Connect** — Optional Google & GitHub OAuth + GitLab & AWS CodeCommit (PAT) tools via Settings → Connections (tokens stay local)
- **Extend** — MCP servers, Claude Code skills/plugins, `CLAUDE.md` / `AGENTS.md`, automations, tray
- **Subagents** — Session-internal subagents with tool policy, orchestration, optional worktree review → apply, and a dedicated browser tab per run for parallel browsing
- **Multi-root** — Extra project roots with effective tool cwd; panels and agent tools stay root-aware
- **Sessions** — Durable plan/thinking, edit & regenerate (attachments preserved), restore, secret-safe backup export
- **Usage & budget** — Context meter, spend soft-caps, usage panel
- **Updates** — Settings / launch check against GitHub Releases; download the matching installer and open it
- **Route** — Multi-model auto routing, cache-aware stickiness, DeepSeek/MiMo thinking + vision fallback
- **Providers (BYOK)** — Paste a key for OpenAI, Anthropic, OpenRouter, DeepSeek, **OpenCode Go**, **Command Code**, **Xiaomi MiMo**, Gemini, xAI, Groq, and more — or any custom OpenAI-/Claude-compatible base URL. Keys encrypted at rest via OS `safeStorage` when available
- **Live model lists** — Settings → Providers → **Sync models** pulls `GET {baseUrl}/models` so catalogs stay fresh (seed presets are only a bootstrap)

UI: ChatGPT-style layout, terminal / files / git / diff / browser panels, light & dark themes. Languages: English, Korean, Japanese, Chinese.

### Latest — v0.11.1

**Security hardening + subagent UX + stability**
- **Project hooks gated (security)** — hooks from the opened repo's `.claude/settings.json` / `.pawn/hooks.json` no longer run by default: those files ship with untrusted repos and can execute arbitrary shell commands. Enable them per user choice in Settings → Hooks; user-scope hooks (~/.claude, Pawn dir) always work. `npm audit` is clean (0 known vulnerabilities)
- **Subagent live status inline** — helpers show as a collapsible bar in the chat (“N agents working…”) you can expand to watch each run; the right-panel Agents tab stays for history and no longer force-opens when work starts
- **Subagent browser panel** — the side panel closes once all subagent browsing is done (only when a subagent opened it — a panel you opened or are viewing is never touched), debounced so multi-phase research pipelines don’t flicker
- **Stability** — subagent runs always reach a terminal state, even on unexpected crashes (no phantom “running” entries); sidebar session search falls back to the in-memory list when the database is unavailable
- **UI** — plan / agent / review widgets now align to the chat column width; the Korean UI uses “에이전트” instead of “도우미”

### v0.11.0 — queue/steer simplification + session search + overlay hardening
- **Queue/steer simplified** — the composer toggle is gone; sends follow the send mode set in Settings, and while the agent is running in queue mode a small **Steer** button appears next to Stop to send the draft immediately
- **Session search** — the sidebar now searches every session's title **and message contents** through the database, so even sessions you've never opened show up in results
- **Overlay hardening** — opening Settings hides the embedded browser (a native view that renderer z-index can't cover) and restores it on close; the browser page and tabs stay alive

---

### v0.10.0 — multi-tab browser + subagent parallel browsing + `research_report`

- **Multi-tab browser** — tab bar in the browser panel, `browser_tab_new / list / switch / close` tools, popups open new tabs
- **Subagent parallel browsing** — per-owner tabs (`session:` / `subagent:` / UI), parked background tabs that never disturb the visible page, reclaimed automatically when a run ends
- **`research_report`** — planner → parallel research workers (each in its own tab, mixing `web_search` / `web_research` / `web_fetch` with `browser_*`) → deduplicated dossier → citation-checked report artifact (`<project>/artifacts/`, or `~/Downloads/pawn-artifacts/` with no project open)
- **Stability hardening** — every fire-and-forget IPC call now catches rejections; optional-chain short-circuit bug fixed; the research pipeline fails with a clean tool error
- Plus: Agents-panel layout hardening, refreshed README/CONTRIBUTING

---

## Providers

Pawn never ships vendor keys. You bring your own (BYOK).

| Preset | Notes |
|--------|--------|
| OpenAI, Anthropic, OpenRouter, Google Gemini, xAI, Groq, … | Standard OpenAI- or Claude-compatible endpoints |
| DeepSeek | V4 Flash/Pro; disk cache + thinking (`reasoning_content` echo on tool loops) |
| **OpenCode Go** | Subscription gateway for open coding models — [docs](https://opencode.ai/docs/ko/go/) · base `https://opencode.ai/zen/go/v1` |
| **Command Code** | Multi-model Provider API — [docs](https://commandcode.ai/docs/provider) · base `https://api.commandcode.ai/provider/v1` |
| **Xiaomi MiMo** | OpenAI + Anthropic paths — [docs](https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call) · `https://api.xiaomimimo.com/v1` |

After adding a provider, use **Sync models** (or rely on the auto-sync on preset add) so the model list comes from the provider API instead of a stale hardcoded catalog. **Test** probes with a model already attached to that provider (not a generic `gpt-4o-mini`).

---

## Install

**Quick install (recommended):**

```bash
npx @parkjangwon/pawn
```

Or install the CLI globally:

```bash
npm install -g @parkjangwon/pawn
pawn
```

**Manual download:** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| Platform | Package |
|----------|---------|
| macOS | `pawn-<version>-universal.dmg` (Apple Silicon + Intel). First open: right-click → **Open** (unsigned). |
| Windows | `pawn-<version>-x64-setup.exe` or `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64.AppImage` / `.deb` (or `npm run dist:linux`) |


### Signing / notarization (maintainers)

Release builds are unsigned by default. To ship Gatekeeper-friendly macOS builds, set these GitHub Actions secrets on the repo:

- `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID certificate (p12)
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` — notarization

The `afterSign` hook (`build/notarize.cjs`) runs only when those vars are present.

**Requirements:** macOS 10.12+ / Windows 10+ / Linux · OpenAI- or Claude-compatible API key (BYOK)

After launch: add your API key in Settings, open a project folder, and chat.

---

## For agents (setup & maintenance)

Humans only need this page. **Coding agents** that install, configure, or maintain Pawn should read the full guide:

| Language | Guide |
|----------|--------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

Those docs cover every built-in tool, Memory/hooks/MCP paths, `~/.pawn` layout, computer-use OS deps, OAuth notes, and how to build from source.

**Tip for users:** paste this repo URL to an agent and say what you want (e.g. “install skills”, “wire MCP”, “enable computer use on macOS”). Point it at `docs/agent/GUIDE.md`.

---

## License

MIT — [LICENSE](./LICENSE). OAuth privacy: [PRIVACY.md](./PRIVACY.md).

Public-web research adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT).
