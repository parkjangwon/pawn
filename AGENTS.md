# PROJECT KNOWLEDGE BASE

**Commit:** 6fe44a3 · **Branch:** master · **Version:** 0.20.0

## OVERVIEW
Pawn is an Electron desktop AI coding agent (BYOK). The agent loop runs in the renderer. Every OS capability sits in the main process behind IPC. Stack: electron-vite 6 (beta), React 19, Zustand 5, better-sqlite3 13, Vitest 4, TypeScript strict, ESM (`"type": "module"`), Node ^20.19 || >=22.12.

The maintenance guide is `docs/agent/GUIDE.md`. It covers data paths, the tool catalog, the agent loop and security constraints. Read it; this file does not repeat it.

## STRUCTURE
```
src/
  main/          Electron main: IPC handlers + Node capability modules (see src/main/AGENTS.md)
    ipc/         handleTrusted-gated handlers, registerAllIpc() (see src/main/ipc/AGENTS.md)
  preload/       index.ts - ONE monolithic `api` object -> window.api (contextBridge)
  renderer/src/
    agent/       LLM calls, router, tools, permissions, subagents (see agent/AGENTS.md)
    stores/      Zustand stores; chatLoop.ts = agentLoop (see stores/AGENTS.md)
    components/  flat React components + co-located CSS (see components/AGENTS.md)
    i18n/        en/ko/ja/zh JSON; key parity enforced by tests
    types/       global.d.ts = ambient window.api typing (1372 LOC)
    utils/ hooks/ styles/global.css
  headless/      pawn-headless CLI + eval harness, runs renderer stores in Node (see src/headless/AGENTS.md)
  test/setup.ts  vitest shims (Node 22 localStorage, matchMedia)
native/macos/pawn-cua/  Swift computer-use helper (see its AGENTS.md)
npm/             `pawn` installer runner (separate package, v0.9.0)
docs/agent/      GUIDE.md (+ ko/ja/zh)
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| New agent tool | `agent/toolDefs/<domain>.ts` + `agent/toolHandlers/<domain>.ts` + `agent/toolPermission.ts` (TOOL_SAFETY) |
| Claude Code–compatible mod | `docs/agent/MODS.md` · `src/main/mods/*` + `src/renderer/src/agent/mods/*` + Settings → Plugins → Mods; sample `examples/mods/first-mod/` |
| New IPC channel | `src/main/ipc/<domain>.ts` (handleTrusted) + `registerAllIpc` + `src/preload/index.ts` + `types/global.d.ts` |
| Agent turn loop | `src/renderer/src/stores/chatLoop.ts` (`agentLoop`) |
| LLM transport / retries | `src/renderer/src/agent/llm.ts` |
| Model routing (simple/medium/complex) | `src/renderer/src/agent/router.ts` |
| SQLite schema / CRUD | `src/main/db.ts` (`getStmt` cache) |
| App boot, CSP, single-instance | `src/main/index.ts` |
| Settings section | `components/settingsMeta.ts` SECTIONS + `Settings.tsx` render branch |
| New UI language | `i18n/locales/xx.json` + `i18n/index.ts` + Settings selector |
| Headless / CI runs | `src/headless/cli.ts`, `nodeApi.ts` |

## CONVENTIONS
- There are three build targets: electron-vite (app), plain Vite `dev:web` (renderer in a browser with `browser-polyfill.ts` faking `window.api` over dev `/api/*`), and a Vite SSR headless bundle. Renderer code must survive all three, so treat `window.api` as possibly absent (`window.api?.`).
- Renderer code reaches the main process only through `window.api.*`. It never imports `src/main` or `electron`.
- Every fire-and-forget `window.api.*` promise gets `.catch(() => {})`. After an optional chain use `?.catch?.()`; never write `x?.y().catch()`.
- Results are envelopes, not throws: `{ ok, error?, ... }` across IPC and tools.
- Imports are relative. The `@/` alias exists in configs but is effectively unused.
- Exports are named. The exception is React components, which default-export one function component.
- When a module is split, the old path re-exports the new pieces (`chat.ts`, `tools.ts`, `subagent.ts`) so existing importers keep working.
- Test hooks are prefixed `__` (`__resetToolsetsForTests`, ...) and exported from prod modules.
- Local state lives under `~/.pawn`. `config.toml` is read with smol-toml; arrays replace wholesale on save.
- There is no ESLint or Prettier. The quality gate is `typecheck -> test -> build`.
- UI copy comes from i18n in all four locales (en/ko/ja/zh, parity + voice enforced by `i18n/__tests__`); Korean stays 해요체, ja/zh must not contain 3+ consecutive English words.
- Design tokens are enforced by `styles/__tests__/designTokens.test.ts`: z-index only via `--z-*`, status colors only via `--success/--danger/--warning/--primary` (never raw hex). `settings.<id>` nav keys are plain strings — group sub-keys live at `settings.<id>Section.*`.
- No emojis in the UI; use SVG icons (CONTRIBUTING). Shared glyphs come from `components/icons.tsx`; do not re-inline duplicated paths in new code.

## ANTI-PATTERNS (THIS PROJECT)
- Never set `nodeIntegration: true` or disable `contextIsolation`, and never run Node or native modules in the renderer.
- Never register raw `ipcMain.handle`; use `handleTrusted`. The only exceptions are the `memory.ts` and `terminal.ts` handlers, which do their own trust check.
- Never allow a remote `img-src` in the CSP (a markdown image would be a zero-click exfil path).
- Never drop the single-instance lock, because two instances corrupt the SQLite WAL.
- Never merge `transcripts` into UI `messages`; the split keeps the prompt-cache prefix stable.
- Never downgrade the model mid-turn (cache stickiness), unless the saving beats the re-prime cost.
- Never hardcode OAuth/API secrets under `src/`. They are injected at build time (`.github/OAUTH_SECRETS.md`).
- Never add `any` in new production code. Existing `(window as any).__*` bridges are legacy.

## COMMANDS
```bash
npm run dev            # electron-vite dev (HMR)
npm run dev:web        # renderer only, browser polyfill
npm run typecheck      # node + web + headless tsconfigs
npm test               # vitest run (env node; jsdom per file via // @vitest-environment jsdom)
npm run check          # typecheck && test && build  <- run before handing off
npm run build:native   # pawn-cua universal binary (macOS, swiftc)
npm run build:headless && npm run headless -- run "task" --cwd DIR
npm run eval           # headless eval suite
npm run dist:mac|win|linux
```
Live tests are gated by env: `PAWN_KIRO_E2E`, `PAWN_CUA_E2E`, `PAWN_TYPESAFE_E2E`, `PAWN_E2E`.

## NOTES
- CI (`.github/workflows/ci.yml`) runs Node 22 `npm ci -> typecheck -> test` and no packaging. Release is tag `v*` only and never runs on pull_request.
- Largest files: `stores/chatLoop.ts` (1505), `components/ChatArea.tsx` (1340), `types/global.d.ts` (1372), `main/ipc/browser.ts` (1099), `agent/subagentRun.ts` (1060), `agent/llm.ts` (999).
- Every new preload channel needs matching typing in `types/global.d.ts` and, if headless should support it, `src/headless/nodeApi.ts`.
