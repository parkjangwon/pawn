# `@parkjangwon/pawn`

Installer runner for **Pawn** — the AI Desktop Coding Agent.

Running `pawn` fetches the latest GitHub Release build for your OS/arch and
launches it, so you don't have to hunt for the right download.

## Usage

```sh
npx @parkjangwon/pawn
```

or install globally:

```sh
npm install -g @parkjangwon/pawn
pawn
```

## Supported builds

- macOS — universal `.dmg` (Apple Silicon + Intel)
- Windows — x64 and arm64 `.exe` installers

The matching installer is cached under `~/.pawn/installers/` and reused when the
latest release hasn't changed.

> Pawn itself is BYOK and runs locally. See the [main repo](https://github.com/parkjangwon/pawn) for docs.
