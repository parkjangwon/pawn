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

- macOS — `pawn-<version>-universal.dmg` (Apple Silicon + Intel)
- Windows — `pawn-<version>-x64-setup.exe` / `pawn-<version>-arm64-setup.exe`
- Linux — `pawn-<version>-{x64,arm64}.AppImage` and `.deb` from GitHub Releases

The matching installer is cached under `~/.pawn/installers/` and reused when the
latest release hasn't changed. Inside the app, **Settings → System** can also
check Releases and download the same installers.

> Pawn itself is BYOK and runs locally. See the [main repo](https://github.com/parkjangwon/pawn) for docs.
