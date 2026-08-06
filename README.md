# Pawn

[한국어](./README.ko.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**Your piece on the board.** A desktop AI coding agent that works for you — code, browse, automate, remember — with your keys, your machine, your rules.

Pawn is not another locked-in cloud IDE. Bring any OpenAI- or Claude-compatible API, install the skills you need, and keep long-term memory and tokens on disk under `~/.pawn`. No harness. No product pipeline you didn’t ask for.

### Why “Pawn”?

In chess, the pawn is the piece that **does the work**: it advances, holds the line, and becomes whatever the game needs. Pawn is that unit for your desktop — humble, local-first, and under *your* control, not a throne you rent from a vendor.

---

## What it can do

- **Code** — File tools, shell, git, symbol search, checks, and a full agent loop with permissions
- **Browse** — Embedded Chromium (`browser_*`) for real web UIs and logged-in sessions
- **Research** — Public web search/fetch without extra API keys (`web_search`, `web_fetch`, `web_research`)
- **Computer use** — Desktop mouse, keyboard, screenshot, and clipboard (`computer_*`)
- **Remember** — Local long-term Memory (`~/.pawn/memory.db`) that personalizes the agent over time
- **Hooks** — Claude/Codex-compatible lifecycle hooks (Claude + Pawn configs merge with dedupe)
- **Connect** — Optional Google & GitHub OAuth + GitLab & AWS CodeCommit (PAT) tools via Settings → Connections (tokens stay local)
- **Extend** — MCP servers, Claude Code skills/plugins, `CLAUDE.md` / `AGENTS.md`, automations, tray
- **Route** — Multi-model auto routing, cache-aware stickiness, DeepSeek/MiMo thinking + vision fallback
- **Providers (BYOK)** — Paste a key for OpenAI, Anthropic, OpenRouter, DeepSeek, **OpenCode Go**, **Command Code**, **Xiaomi MiMo**, Gemini, xAI, Groq, and more — or any custom OpenAI-/Claude-compatible base URL
- **Live model lists** — Settings → Providers → **Sync models** pulls `GET {baseUrl}/models` so catalogs stay fresh (seed presets are only a bootstrap)

UI: ChatGPT-style layout, terminal / files / git / diff / browser panels, light & dark themes. Languages: English, Korean, Japanese, Chinese.

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
| macOS | `Pawn-<version>-universal.dmg` (Apple Silicon + Intel). First open: right-click → **Open** (unsigned). |
| Windows | `Pawn-<version>-x64-setup.exe` or `…-arm64-setup.exe` |
| Linux | `.AppImage` / `.deb` (or build with `npm run dist:linux`) |

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
