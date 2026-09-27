# Pawn

[한국어](./README.ko.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**Your piece on the board.** A desktop AI coding agent that works for you — code, browse, automate, remember — with your keys, your machine, your rules.

Pawn is not another locked-in cloud IDE. Bring any OpenAI- or Claude-compatible API, install the skills you need, and keep long-term memory and tokens on disk under `~/.pawn`. No harness. No product pipeline you didn’t ask for.

### Why “Pawn”?

In chess, the pawn is the piece that **does the work**: it advances, holds the line, and becomes whatever the game needs. Pawn is that unit for your desktop — humble, local-first, and under *your* control, not a throne you rent from a vendor.

---

## What it can do

- **Code** — File tools, shell, git, symbol search, checks, and a full agent loop with permissions
- **Agent physicals** — model-native tools (Claude text editor + persistent bash, GPT `apply_patch`), tools that start while the model is still streaming, a real debugger (Node, Python, Go, C/C++/Rust), LSP rename / quick fixes / call hierarchy, local semantic code search, affected-test selection, dev-server & browser runtime error perception, long-task endurance (output offloading, context clearing, working notes, checkpoints), a stuck-recovery ladder with second opinions, and a learned repo profile + lessons from your corrections
- **Browse** — Embedded Chromium (`browser_*`) for real web UIs and logged-in sessions. **Multi-tab**: the agent, the UI panel, and every subagent get their own tab (per-owner isolation) and browse in parallel without ever yanking your view
- **Research** — Public web search/fetch without extra API keys (`web_search`, `web_fetch`, `web_research`), plus **`research_report`**: parallel research subagents (each in its own tab) whose findings are deduplicated and synthesized into a citation-checked report artifact
- **Computer use** — Operate any Mac app like Codex / Claude computer use: native helper with accessibility-tree element actions, app/window/menu control, high-res screenshots + zoom, on-device OCR, IME-safe typing, multi-monitor, Claude's native computer tool; Esc×2 stops (`computer_*`; Windows/Linux: basic mouse/keyboard)
- **Record & Replay** — Show Pawn a task once in its browser or any Mac app; it writes a reusable skill the agent replays with new inputs or on a schedule (macOS)
- **Decisions** — Optional decision models (hosted TypeSafe Jev, or local Ollaya) for fast, calibrated yes/no, pick-one and score judgments: a `decide` tool, a risk check on shell commands, and help for auto routing
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

### Latest — v0.15.0

**Record & Replay + decision models**
- **Record & Replay (macOS)** — Show Pawn a workflow once, get a reusable skill. Press the record button in the composer (or `/record`), do the task in Pawn's browser and/or any Mac app, then stop (Esc twice works too). Pawn writes a `SKILL.md` with the inputs that change per run, steps by visible label (not coordinates), checks, and a confirm-before-submit rule. Save it to `~/.agents/skills`, run it again with new inputs (`/skill-name`), refine it in chat, or schedule it as an automation
- **Private by design** — passwords, one-time codes, card fields and macOS secure fields are never recorded, Pawn's own windows and the agent's own input are ignored, and a red on-screen pill shows while recording. The raw recording lives in memory only and is gone once the skill is written
- **Decision models (optional)** — Settings → Decision models adds a fast "System One" judge next to your chat model: **TypeSafe Jev** (hosted, first-party, official SDK) or **Ollaya** (Laya, Winnow and other open models on your Mac). The agent gets a `decide` tool for triage, ranking and checks; shell commands that would run without asking are re-checked and sent back to you when they look destructive or would send data out; auto routing can use it to judge how hard a request is. Everything falls back to normal behavior when the model is slow or off
- **Also** — `save_skill` tool, "Record a workflow…" in the menu bar, native helper 1.1.0

Earlier release notes: [GitHub Releases](https://github.com/parkjangwon/pawn/releases).

---

## Providers

Pawn never ships vendor keys. You bring your own (BYOK).

| Preset | Notes |
|--------|--------|
| OpenAI, Anthropic, OpenRouter, Google Gemini, xAI, Groq, … | Standard OpenAI- or Claude-compatible endpoints |
| **Kiro** | Sign in with AWS Builder ID / IAM Identity Center, a Kiro API key (`ksk_…`), or your Kiro CLI / IDE login (read-only); models synced live (Claude, GPT-5.6, open-weight), credits shown in Settings. Unofficial protocol integration — use at your own risk |
| DeepSeek | V4 Flash/Pro; disk cache + thinking (`reasoning_content` echo on tool loops) |
| **OpenCode Go** | Subscription gateway for open coding models — [docs](https://opencode.ai/docs/ko/go/) · base `https://opencode.ai/zen/go/v1` |
| **Command Code** | Multi-model Provider API — [docs](https://commandcode.ai/docs/provider) · base `https://api.commandcode.ai/provider/v1` |
| **Xiaomi MiMo** | OpenAI + Anthropic paths — [docs](https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call) · `https://api.xiaomimimo.com/v1` |

After adding a provider, use **Sync models** (or rely on the auto-sync on preset add) so the model list comes from the provider API instead of a stale hardcoded catalog. **Test** probes with a model already attached to that provider (not a generic `gpt-4o-mini`).

### Decision models (optional)

| Provider | Notes |
|----------|-------|
| **TypeSafe** (Jev) | Hosted, first-party. API key from the [TypeSafe console](https://console.typesafe.ai); called through the official `@typesafe-ai/sdk`. Billed per input token by TypeSafe |
| **Ollaya** | Open decision models (Laya, Winnow, decider, …) on your Mac at `http://localhost:11435` — [download](https://ollaya.dev/download), then `ollaya pull laya`. No key, nothing leaves your machine |
| Custom | Any TypeSafe-compatible server (`/v1/systemone`) |

Keys are encrypted in `~/.pawn/decision.json`, and secrets are redacted from every request.

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
