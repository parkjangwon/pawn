# src/main/ipc - IPC handlers

## OVERVIEW
There are 28 per-domain handler files. `index.ts` `registerAllIpc()` wires them all and is called once from `src/main/index.ts`. `trust.ts` is the security choke point.

## ADDING A CHANNEL (all four, or it is broken)
1. `ipc/<domain>.ts`: `export function register<Domain>Ipc()` with `handleTrusted('domain:action', async (_e, ...args) => ...)`.
2. Import it and call it in `registerAllIpc()` (`index.ts`). There is no auto-discovery. Also export `dispose<Domain>()` if the domain holds resources, and call it from `src/main/index.ts` teardown.
3. Expose it in `src/preload/index.ts`: add `ipcRenderer.invoke` for requests, or `send` plus an `onX(cb)` that returns an unsubscribe for streams.
4. Type it under `interface Window { api }` in `src/renderer/src/types/global.d.ts`. Mirror it in `src/headless/nodeApi.ts` if headless needs it.

## CONVENTIONS
- `handleTrusted` (`trust.ts`) rejects senders that fail `isTrustedSender` (main or headless window, top frame, app URL) with `{ error: 'Untrusted sender' }`, and turns throws into `{ error, ok: false }`.
- Channels are named `domain:action` in camelCase. Main-to-renderer pushes use `win.webContents.send('<domain>:event', ...)`.
- Return envelopes `{ ok, text?, error? }`. Validation failures return; they do not throw.
- Clamp numeric options coming from the renderer (see `research.ts`).
- `connections.ts` has one `connections:runTool` handler that dispatches by provider tool Set.

## EXCEPTIONS (do not copy)
- `terminal.ts` uses raw `ipcMain.handle` and `ipcMain.on` with its own `isTrustedSender` check, because of the streaming `terminal:data` path.
- `memory.ts` wraps with `handleMemory` for fallback results.

## HOTSPOTS
- `browser.ts` (1099): WebContentsView browser. Keep `contextIsolation: true` on created views.
- `misc.ts` (602), `fs.ts` (529), `shell.ts` (456; enforces the "never the app's own cwd" rule).

## ANTI-PATTERNS
- Never add a raw `ipcMain.handle` or `ipcMain.on` for a new channel.
- Never let a handler throw across IPC unhandled.
- Never return secrets or tokens to the renderer; return status objects instead.
