# Contributing to Pawn

## Development Setup

```bash
git clone https://github.com/parkjangwon/pawn.git
cd pawn
npm install
npm run dev        # Electron + Vite HMR
npm run dev:web    # renderer-only web preview (no Electron)
```

Quality gates before pushing:

```bash
npm run check   # typecheck (node + web) → test → build
```

## Project Structure

- `src/main/` — Electron main process
  - `src/main/ipc/` — `handleTrusted`-gated IPC handlers (`browser.ts`, `fs.ts`, `config.ts`, …)
  - `src/main/browserTabs.ts` — **pure** tab manager for the embedded browser (Electron-free, unit-tested)
  - `src/main/browserCursor.ts`, `src/main/browserPicker.ts` — injected in-page overlays
  - `src/main/db.ts` — SQLite (WAL), `src/main/memory/` long-term memory, `src/main/research/` engine
- `src/preload/` — secure `contextBridge` (`window.api`); no Node in the renderer
- `src/renderer/src/`
  - `agent/` — the agent itself
    - `toolDefs/` — tool JSON schemas sent to the model
    - `toolHandlers/` — name → executor (`types.ts` defines `ToolExecContext`)
    - `toolExecutor.ts` — dispatcher (permission, hooks, MCP routing, try/catch)
    - `agentProfiles.ts` — built-in subagent profiles + tool allow/deny lists
    - `subagent.ts` — facade; `subagentRun.ts` / `subagentWorktree.ts` / `subagentOrchestration.ts` / `subagentToolPolicy.ts` implement it
    - `researchReport.ts` — `research_report` pipeline (planner → parallel workers → dossier → synthesizer)
    - `artifacts.ts` — project-local artifacts shelf (+ Downloads fallback when no project)
  - `stores/` — Zustand stores (`chat.ts` + `chatLoop.ts`/`chatTranscript.ts`/`chatState.ts`, `subagentRuns.ts`, …)
  - `components/` — React UI (`BrowserView.tsx` hosts the native WebContentsView panel)
  - `i18n/` — en / ko / ja / zh translations

## Adding a New Tool

1. Add the JSON schema in `src/renderer/src/agent/toolDefs/<area>.ts` (exported array is spread into `TOOLS`).
2. Add the handler in `src/renderer/src/agent/toolHandlers/<area>.ts` and register it in that file's handler record.
3. Classify it in `src/renderer/src/agent/toolPermission.ts`:
   - `TOOL_SAFETY` (`'safe'` runs parallel, `'risky'` serial)
   - the permission-category map and the human-readable label
4. Add a test under `src/renderer/src/agent/__tests__/` (handlers map results; keep them mock-based).
5. Run `npm run check`.

The tool is then automatically available to the LLM — no registration elsewhere.

## Embedded Browser Architecture

- **Main-owned `WebContentsView`** — one view per browser tab, owned by `src/main/ipc/browser.ts`. The renderer only drives it through IPC; the UI panel and agent tools share the same state.
- **Owner-key tabs (parallel browsing)** — each tab is bound to an owner: `session:<id>` (drives the visible tab), `subagent:<runId>` (a parked background tab), or `null` (UI-created). `resolveTab(owner)` reuses an owner's tab instead of spawning new ones; subagent tabs are reclaimed via `browser:releaseOwner` when a run ends. `BrowserTabManager` (pure) holds create/switch/close/neighbor rules.
- **Hard limits** — `MAX_TABS` cap, http/https-only `normalizeBrowserUrl`, per-tab `sandbox + contextIsolation`, session partition separate from the app.

## Subagents & research_report

- Subagent profiles live in `agentProfiles.ts` (explore / plan / worker / code-reviewer / synthesizer). Tool policy (allow/deny, budgets) is enforced twice: as the LLM tool allowlist *and* hard-blocked in the run loop.
- `research_report` runs a planner, parallel explore workers (each in its own tab, mixing `web_search`/`web_research`/`web_fetch` with `browser_*`), then a **synthesizer** — a deliberately narrow builtin (read + `write_artifact` only) that is pinned via `forceBuiltinProfile` so a project agent file can never widen its tool surface over untrusted web content.

## Adding a New Language

1. Create `src/renderer/src/i18n/locales/xx.json` (mirror an existing locale).
2. Import and register it in `src/renderer/src/i18n/index.ts`.
3. Add the option in the Settings language selector.

## Code Style

- TypeScript strict mode; no `any` in new production code
- No emojis in UI (use SVG icons)
- CSS variables for theming (no hardcoded colors)
- Zustand for state management; functional components with hooks
- Every fire-and-forget `window.api.*` promise gets `.catch(() => {})` (or `?.catch?.()` after optional chains — a short-circuited optional call returns `undefined`, so never write `x?.y().catch()`)

## Security

- Never use `nodeIntegration: true`; always `contextBridge` for IPC
- All IPC handlers go through `handleTrusted` (trusted-sender gating + try/catch → `{ error }`)
- No `rehype-raw` in markdown rendering; CSP enforced in production
- Browser: http/https allowlist only (no `file:`/`javascript:`/`data:`), per-owner tab isolation, `MAX_TABS` cap, artifact names reject `..`/absolute paths
- Permission system for sensitive operations
- **OAuth client secrets must not be committed.** Use `.env` locally and GitHub Actions secrets for release builds (see [.github/OAUTH_SECRETS.md](./.github/OAUTH_SECRETS.md)).

## Service connections (Google / GitHub OAuth)

```bash
cp .env.example .env
# fill PAWN_GOOGLE_* and PAWN_GITHUB_*
npm run dev
```

Release builds inject the same variables from repo Actions secrets during `npm run build`. Do not hardcode secrets under `src/`.

## License

MIT
