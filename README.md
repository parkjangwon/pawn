# hjcode Desktop

AI Coding Agent GUI — Code, Browse, Automate.

A desktop application that combines the best of Cursor's auto mode, ChatGPT's UI, OpenCode's BYOK, and Claude Desktop's browser use. No harness, no lock-in — bring your own keys, install your own plugins, build your own agent.

## Philosophy

- **No harness** — pure canvas. Users install plugins/skills they need.
- **BYOK** — register any OpenAI or Claude compatible API endpoint.
- **Auto mode** — multi-model routing based on task complexity.
- **Open source** — MIT licensed, fully customizable.
- **Claude Code compatible** — loads `CLAUDE.md`, `.claude/skills/`, `.claude/rules/`, and `.agent/` directories.

## Features

### Core Agent
- Tool-calling agent loop (up to 25 rounds per turn)
- File system: read, write, edit, list, delete
- Shell command execution
- Computer Use: screenshot, click, type, keypress
- Browser Use: open URLs
- Permission system with user approval dialogs
- Queue / Steering send modes

### Providers & Models
- OpenAI API format (GPT-4o, o1, etc.)
- Claude API format (Claude 3.5, 4, etc.)
- Custom endpoints (any OpenAI-compatible API)
- API Key or OAuth authentication
- Auto mode: model routing by task complexity (low/mid/high tiers)
- Prompt cache optimization (Claude `cache_control`, OpenAI stable prefix)

### UI
- ChatGPT-style layout (sidebar + chat area)
- Light / Dark theme (in Settings > Appearance)
- Responsive: desktop, tablet, mobile
- Markdown rendering with syntax highlighting
- Code blocks with copy button
- Streaming responses with cursor animation
- Auto-scroll on new messages
- i18n: English, Korean, Japanese, Chinese

### Projects & Sessions
- Project = local folder path
- Multiple sessions per project
- Persistent state (localStorage)
- Native folder selection dialog (Electron)

### Automation
- Scheduling system (interval-based tasks)
- OS native notifications
- Cron-style automation via IPC

### Extensibility
- Claude Code skill format (`.claude/skills/*/SKILL.md`)
- Codex-compatible `.agent/` directory
- `CLAUDE.md` / `CLAUDE.local.md` project context
- `.claude/rules/*.md` rule files
- Plugin marketplace (planned)

### Security
- Context isolation + contextBridge (no nodeIntegration)
- Content Security Policy headers
- Permission requests for sensitive operations
- No `rehype-raw` in markdown (XSS prevention)
- Sandbox support (configurable)

## Tech Stack

- **Electron** — desktop shell
- **React 19** — UI framework
- **TypeScript** — type safety
- **Vite** (via electron-vite) — build tooling
- **Zustand** — state management with persistence
- **i18next** — internationalization
- **react-markdown** + **rehype-highlight** — markdown rendering
- **highlight.js** — code syntax highlighting

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

Output goes to `release/` directory.

## Project Structure

```
src/
├── main/              # Electron main process (IPC, CSP, window management)
├── preload/           # Context bridge (secure API exposure)
└── renderer/          # React app
    └── src/
        ├── agent/     # Agent loop, tools, skills, routing
        ├── components/ # UI components
        ├── i18n/      # Translations (en, ko, ja, zh)
        ├── stores/    # Zustand stores (app, chat, provider, theme, permission)
        ├── styles/    # Global CSS with theme variables
        └── types/     # TypeScript definitions
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Renderer (React)                           │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Sidebar │  │ ChatArea │  │ Settings  │  │
│  └────┬────┘  └────┬─────  └─────┬─────┘  │
│       │             │              │         │
│  ┌────┴─────────────┴──────────────┴─────┐  │
│  │         Zustand Stores               │  │
│  │  app | chat | provider | permission  │  │
│  └────────────────┬─────────────────────┘  │
│                   │                         │
│  ┌────────────────┴─────────────────────┐  │
│  │         Agent Loop                   │  │
│  │  LLM call → tool parse → execute →   │  │
│  │  feed result → repeat until done     │  │
│  └────────────────┬─────────────────────┘  │
└───────────────────┼─────────────────────────┘
                    │ contextBridge (IPC)
┌───────────────────┼─────────────────────────┐
│  Main Process     │                         │
│  ┌────────────────┴─────────────────────┐  │
│  │  IPC Handlers                        │  │
│  │  fs | shell | computer | browser |   │  │
│  │  notification | schedule | dialog    │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## License

MIT
