# renderer/src/agent - agent core

## OVERVIEW
This is the agent core: LLM transport, model routing, prompts, transcript and compaction, tools, permissions and subagents. The turn loop itself lives in `../stores/chatLoop.ts`. The tool catalog and loop limits are in `docs/agent/GUIDE.md`.

## STRUCTURE
```
llm.ts              callLLM: provider streaming, retries (4xx/parse never retry)
router.ts           simple/medium/complex routing + stickiness
prompts.ts          system prompt (agent-facing NEVER rules live here)
transcript.ts compaction.ts contextEditing.ts   cache-stable history
toolDefinitions.ts  TOOLS = concat of toolDefs/*  (*_TOOLS: ToolDefinition[])
toolDefs/<domain>.ts           schemas
toolHandlers/<domain>.ts       handlers; index.ts spreads into TOOL_HANDLERS
toolExecutor.ts     executeTool: lookup + dispatch
toolPermission.ts   TOOL_SAFETY, NEEDS_APPROVAL_IN_AUTO, deny/allow rules
toolsets.ts         TOOL_GROUPS exposure ("tool diet"), multilingual keyword regex
subagentCore.ts subagentRun.ts (1060) agentProfiles.ts   subagents (HARD_MAX_ROUNDS 25, MAX_PARALLEL 6)
tools.ts subagent.ts  facades re-exporting split modules
__tests__/          53 files; covers toolDefs/toolHandlers too (they have no own tests)
```

## ADDING A TOOL
1. `toolDefs/<domain>.ts`: add a schema to `<DOMAIN>_TOOLS`. Tool names are snake_case; if the file is new, concat it into `TOOLS`.
2. `toolHandlers/<domain>.ts`: add a handler keyed by tool name with the `ToolHandler` signature `(call, projectPath, signal, ctx, api)`. Spread it into `TOOL_HANDLERS`.
3. `toolPermission.ts`: add a `TOOL_SAFETY` level, and add to `NEEDS_APPROVAL_IN_AUTO` if it is risky.
4. `toolsets.ts`: add it to an optional group if it should not always be exposed. Account-backed groups stay hidden until the account is connected.
5. Add a test under `__tests__/`, then run `npm run check`.

## CONVENTIONS
- Handlers return `{ toolCallId, content, isError: true }` on failure. Never throw.
- Handlers call the main process only via the `api` argument or `window.api`. They must also work in headless, where `api` is the Node implementation.
- Exposed toolsets only grow within a transcript, which keeps the prompt cache stable. Groups fail open; MCP tools are never hidden.
- Use subagent profile names (`agent`). `SubagentMode` explore|worker is deprecated.
- Use `needsReasoningContentEcho` from `deepseekCompat`. The helper in `transcript.ts` is deprecated.

## ANTI-PATTERNS
- Never reorder or rewrite earlier transcript entries (cache prefix). The compaction tail must never start on a tool result.
- A permission layer (decision, hooks) can only add a prompt, never skip one. Deny always wins, even in YOLO mode.
- Subagents never escalate out of `low` and never widen policy into system paths. They never retry blocked calls or flood the parent.
- `editVerify` fails open and never throws. `fileTransaction` never leaves a file half-patched.
- Mention prefetch never reads arbitrary absolute paths.
