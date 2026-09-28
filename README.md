<img width="1728" height="1117" alt="image" src="https://github.com/user-attachments/assets/20c436e7-7059-4355-8fa5-78f443feead4" />

# Pawn

[한국어](./README.ko.md) · [中文](./README.zh.md) · [日本語](./README.ja.md)

**Your piece on the board.** A desktop AI agent that codes, browses, and uses the computer — your API keys, your machine.

Pawn is an Electron app. Point it at any OpenAI- or Claude-compatible API. Sessions, memory, and hooks stay under `~/.pawn`. You install the skills you want.

## What it does

**One agent for the repo, the browser, and the desktop.** It edits files, runs the shell and git, follows a language server, and can attach a real debugger (Node, Python, Go, C/C++/Rust). The built-in browser keeps its own cookies, so logged-in sites are in reach. On a Mac, a native helper drives other apps from the accessibility tree. Windows and Linux get mouse, keyboard, and screenshots.

**Show a workflow once.** On macOS, record yourself in Pawn's browser or any Mac app. Pawn writes a `SKILL.md` you can run again with new inputs, or put on a schedule. Recording skips password fields, one-time codes, card fields, and macOS secure fields.

**Research that cites.** Public pages can be searched and read without another API key. A deeper pass runs parallel research agents and writes a citation-checked report into the project.

**Use the subscription you already have.** Settings can sign in to ChatGPT (Plus, Pro, Team, Enterprise), Claude (Pro, Max, Team, Enterprise), xAI (SuperGrok or X Premium+), and Antigravity (the Google account used there). Usage counts against that subscription. An API key on the matching preset still works, and is what runs while you are signed out. Refresh tokens stay encrypted in `~/.pawn`.

**It stays on this computer.** Keys are stored with the OS keychain when it can. Long-term memory is a local database. Claude Code skills, plugins, `CLAUDE.md`, hooks, and MCP configs are picked up from the usual places. Google, GitHub, GitLab, and AWS CodeCommit connect from Settings when you want them.

**It can keep working.** Auto routing picks a model and stays with it while the prompt cache is warm. Long jobs keep notes and checkpoints. Subagents can take a slice of the work, including in a git worktree. The same agent runs without the window via `pawn-headless`.

## Install

```bash
npx @parkjangwon/pawn
```

Or install the launcher globally:

```bash
npm install -g @parkjangwon/pawn
pawn
```

**Manual download:** [Releases](https://github.com/parkjangwon/pawn/releases/latest)

| Platform | Package |
|----------|---------|
| macOS | `pawn-<version>-universal.dmg` (Apple Silicon + Intel). First open: right-click → **Open**. |
| Windows | `pawn-<version>-x64-setup.exe` or `pawn-<version>-arm64-setup.exe` |
| Linux | `pawn-<version>-x64` / `arm64` `.AppImage` and `.deb` |

macOS 10.12+ / Windows 10+ / Linux. You bring an API key.

After launch, add the key in Settings and open a project folder.

## For agents

People can stop here. Coding agents that install, configure, or change Pawn should read the guide:

| Language | Guide |
|----------|--------|
| English | [docs/agent/GUIDE.md](./docs/agent/GUIDE.md) |
| 한국어 | [docs/agent/GUIDE.ko.md](./docs/agent/GUIDE.ko.md) |
| 中文 | [docs/agent/GUIDE.zh.md](./docs/agent/GUIDE.zh.md) |
| 日本語 | [docs/agent/GUIDE.ja.md](./docs/agent/GUIDE.ja.md) |

## License

MIT — [LICENSE](./LICENSE). OAuth privacy: [PRIVACY.md](./PRIVACY.md).

Public-web research adapted from [insane-search](https://github.com/fivetaku/insane-search) (MIT).
