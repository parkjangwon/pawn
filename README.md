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

## Features

### Core Agent & Tools
- Tool-calling agent loop (up to 25 rounds per turn).
- **File System**: Read, write, edit, list, and delete files safely.
- **Shell execution**: Run CLI tools locally (supports background tasks and standard sandbox modes).
- **Computer Use**: Zero-dependency cross-platform automation:
  - **Multimodal Eyesight**: Feeds screenshots directly to Claude & OpenAI models as image blocks.
  - **macOS Support**: Uses `cliclick` with a robust AppleScript (`osascript`) fallback for typing and hotkeys.
  - **Windows Support**: Zero-dependency PowerShell and `.NET Forms SendKeys` integration.
  - **Linux Support**: Driven via `xdotool`.
  - **High-DPI Normalization**: Normalizes logical coordinate mouse clicks using monitor scale factors.
- **Browser Use**: Open URLs and automate web interactions.
- Permission system with granular user approval dialogs.
- Queue / Steering send modes.

### Providers & Smart Routing
- OpenAI API format (GPT-4o, o1, etc.) and Claude API format (Claude 3.5 Sonnet, etc.).
- Custom endpoints (any OpenAI-compatible API).
- API Key authentication.
- **Smart Model Router**:
  - **Complexity Heuristics**: Automatically classifies task complexity (`simple` | `medium` | `complex`) locally based on input size, keywords, and instructions.
  - **Cache-Aware Routing**: Evaluates the cost of cache writes versus per-token savings before switching models to maximize prompt caching performance.
  - **Automatic Escalation**: Automatically escalates to stronger model tiers when detecting consecutive tool failures or empty model responses.
  - **Failover & Cooldown**: Automatically puts failing providers on a transient cooldown (5s to 120s) to keep the agent responsive.

### Local Database & Persistence
- Powered by **SQLite** (`better-sqlite3` with WAL journal mode) for lightweight, robust local storage.
- **Schemas**:
  - `projects` & `sessions`: Multi-project workspace support.
  - `messages`: Visible chat history.
  - `transcripts`: Byte-stable provider-neutral conversation cache to optimize API prompt caching.
  - `usage`: Tracks detailed usage tokens (input, output, cache-read, cache-write) and estimated costs.
  - `routines`: Recurring scheduled automation routines.

### UI / UX
- ChatGPT-style layout (sidebar + chat area).
- Light / Dark theme (configurable in Settings > Appearance).
- Responsive layout: Optimized for desktop, tablet, and mobile displays.
- Rich Markdown rendering with syntax highlighting and code block copy utilities.
- Streaming responses with cursor animation.
- Auto-scroll on new messages.
- Internationalization (i18n): English, Korean, Japanese, and Chinese.

### Extensibility
- Claude Code skill format (`.claude/skills/*/SKILL.md`).
- Codex-compatible `.agent/` directory.
- OpenAI Agents user context (`~/.agents/AGENTS.md`, `~/.agents/skills/`).
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
├── preload/           # Context bridge (secure API exposure)
└── renderer/          # React app
    └── src/
        ├── agent/     # Agent loop, tools, smart routing, transcripts
        ├── components/# UI components
        ├── i18n/      # Translations (en, ko, ja, zh)
        ├── stores/    # Zustand stores (app, chat, provider, theme, permission)
        ├── styles/    # Global CSS with theme variables
        └── types/     # TypeScript definitions
```

## License

MIT
