# renderer/src/stores - Zustand state

## OVERVIEW
There are 26 stores and no barrel, so import each file directly. `chat.ts` is a facade over `chatLoop.ts` (the `agentLoop`), `chatState.ts` and `chatTranscript.ts`. The most used stores are `useProviderStore`, `useAppStore` and `useChatStore`.

## STRUCTURE
```
chatLoop.ts (1505)  agentLoop: rounds, tool dispatch, stop/teardown, persistence  <- hotspot
chat.ts             facade + re-exports after split (keep import sites working)
chatState.ts        sessionControllers Map, cross-store helpers
chatTranscript.ts   transcript persistence (never truncate)
streaming.ts        token buffers (__flushStreamingForTests)
app.ts              projects/sessions, flush via enqueueDbWrite
provider.ts permission.ts usage.ts prefs.ts mcp.ts routine.ts ultraWork.ts ...
userQuestions.ts    exports useQuestionStore (name mismatch)
__tests__/          21 files, split per concern (chat-edit, chat-llm, chat-resume ...)
```

## CONVENTIONS
- Stores are created with `create<State>((set, get) => ...)` and named `useXStore`. State interfaces stay unexported.
- There is no `persist` or `immer` middleware. Persistence is manual: guarded `localStorage` (`pawn-*` keys) or SQLite via `window.api.db` plus `enqueueDbWrite`.
- Cross-store reads use `useXStore.getState()`. App init is imperative (`getState().init()` from `App.tsx`), never a side effect of store creation.
- Module-scope Maps beside stores hold non-serializable state (controllers, notes).
- `useAutomationStore` is an alias of `useRoutineStore`.
- Headless dynamically imports app, chat, provider, prefs, usage, permission, userQuestions and ultraWork (`src/headless/runner.ts`). Keep them free of DOM-only APIs, or guard those APIs.
- Tests use `setState` fixtures, stub `window.api` in `beforeEach`, and add `// @vitest-environment jsdom` when needed.

## ANTI-PATTERNS (from chatLoop/chat/app comments)
- Never run a turn in the app's own cwd or in system dirs.
- Do not auto-inject repo_map. Never session-ban Vision.
- Always persist reasoning. Never let a failed turn vanish silently.
- Stop always ends UltraWork and never leaves a key held. Never re-mark a turn that was Stopped.
- Never break the teardown order in `chatLoop.ts`.
- Do not clear all streaming buffers inside the `app.ts` flush.
- Never assume an answer for a pending user question.
