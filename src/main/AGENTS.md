# src/main - Electron main process

## OVERVIEW
Node-side capabilities: fs, shell, db, browser, computer use, LSP, debug, MCP, memory, research, connections. The renderer reaches all of them only via `ipc/` (see `ipc/AGENTS.md`).

## STRUCTURE
```
index.ts         boot: single-instance lock, CSP (onHeadersReceived), registerAllIpc(), teardown
window.ts        createMainWindow / ensureHeadlessWindow
db.ts            better-sqlite3 (WAL + FK), getStmt(sql) statement cache, session/message/usage/ledger CRUD
config.ts        ~/.pawn/config.toml (smol-toml), loadConfig / saveConfig deep-merge
agentRuntime.ts  runtime facade (output slices, validProjectRoot); owns CodeIndex
bashSession.ts   persistent PTY shells (largest top-level file, 837)
shellSandbox.ts  planShellSpawn / planExecFile - every spawn goes through here
fsGuards.ts      isSecretDotFile / isProtectedRemovePath
mcpManager.ts skillRegistry.ts worktree.ts routineSchedule.ts contentSearch.ts
ipc/             handleTrusted handlers (own AGENTS.md)
connections/     github, gitlab, google, codecommit: client + *Tools.ts each
computer/        service.ts entry; spawns native pawn-cua on macOS, xdotool/PowerShell elsewhere
codeIndex/       BM25 + hashed embeddings, JSON cache (CACHE_VERSION)
debug/ lsp/ kiro/ decision/ memory/ recorder/ research/ hooks/ telegram/
__tests__/       35 flat tests; some domains also keep a local __tests__/
```

## CONVENTIONS
- Domain folders (debug, decision, kiro, lsp, memory, recorder, research) import no `electron` at all. Electron glue lives in `ipc/`, `window.ts`, `index.ts`, `computer/` and `connections/store.ts`. Keep it that way so the modules stay unit-testable and reusable by `src/headless/nodeApi.ts`.
- Services are DI factories, `createX(deps)`, with `type XService = ReturnType<typeof createX>`. Seams (store, client, spawn, `dir = getPawnDir()`, `home`, `env`) are injected, and tests pass fakes.
- Managers are lazy singletons (`getLspManager()`, `getDebugManager()`). The class is also exported for tests.
- Exports are named only. Barrels exist only in `memory/`, `research/`, `hooks/` and `computer/`; elsewhere, deep-import.
- Validate and normalize at the boundary, then return `{ ok, error }` rather than throwing.
- Connections persist as safeStorage-encrypted files under `~/.pawn/connections`, not SQLite. OAuth defaults are build-injected (`oauthDefaults.ts`).
- To add a provider tool: write the function, add it to the `<X>ToolName` union and the `run<X>Tool` dispatcher, then add it to the Set in `ipc/connections.ts`.
- Test live paths behind env gates with `describe.skipIf(!process.env.PAWN_*_E2E)`.

## ANTI-PATTERNS
- Never spawn a process without `shellSandbox` planning, and never use the app's own cwd as a project root (`agentRuntime.ts`, `ipc/shell.ts`).
- Never read, write or delete paths rejected by `fsGuards`.
- Never let a secret reach the renderer or the logs (`decision/`, `kiro/`, `connections/`, `telegram/`).
- Never refresh or write another app's session (`kiro/auth.ts` reads the Kiro CLI/IDE DB read-only).
- LSP uses global servers only. Never run project-local binaries such as a workspace TypeScript (`lsp/servers.ts`).
- Wrap memory, research and web text as untrusted data (`memory/safety.ts`, `research/contentSafety.ts`). Never persist secrets to memory.
- The recorder never captures password, OTP or card fields, and never records Pawn's own pids.
- Debug resolves the node binary itself and never uses `process.execPath`.
