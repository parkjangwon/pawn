# src/headless - pawn-headless CLI + eval harness

## OVERVIEW
This runs the real renderer agent loop in plain Node, with no Electron window. It is built by `vite.headless.config.ts` into `out/headless/pawn-headless.mjs` (SSR, `noExternal`; better-sqlite3, electron and node-pty stay external) and typechecked by `tsconfig.headless.json`.

## STRUCTURE
```
cli.ts          entry: run "<prompt>" | eval | tasks
runner.ts       installHeadlessGlobals() fakes window/document/localStorage, then dynamic-imports renderer stores; runHeadlessTurn()
nodeApi.ts      createNodeApi(): Node implementation of window.api reusing ../main/* (shellSandbox, contentSearch, fsGuards, computer, agentRuntime, lsp, kiro, decision)
config.ts       CLI/env config (PAWN_API_KEY_<PROVIDER_ID>, OPENAI_API_KEY, ...)
evalHarness.ts evalTasks.ts   eval suite (npm run eval)
__tests__/      computer, decision, headless, kiro.e2e, physical
```

## USAGE
```bash
npm run build:headless
npm run headless -- run "task" --cwd DIR [--mode default|eco|maxing] [--model M] [--permission auto|yolo|deny] [--plan] [--json]
npm run eval
```

## CONVENTIONS
- `nodeApi.ts` must match the preload `window.api` shape for every channel the agent uses. When a preload channel is added or changed, update it here too, or headless silently diverges.
- Import from `../main/*` only for modules that are free of Electron. Domain modules are kept Electron-free for this reason.
- Persistence is in memory. Nothing is written under `~/.pawn`.
- Prompts are answered by policy, never interactively: permission follows `--permission`, and `ask_user` gets the recommended (first) option.
- Live tests are gated: `PAWN_E2E` (physical), `PAWN_KIRO_E2E`, `PAWN_CUA_E2E`. The computer test takes `acquireDesktop` from `src/main/computer/__tests__/desktopLock.ts`.

## ANTI-PATTERNS
- Never weaken the shell sandbox for headless. It deliberately uses the same `shellSandbox` rules as desktop.
- Never import renderer stores statically before `installHeadlessGlobals()` has run.
