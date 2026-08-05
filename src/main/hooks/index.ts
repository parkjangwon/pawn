/**
 * Agent lifecycle hooks — Claude/Codex-compatible schema.
 * Sources merge (not replace) with command/url dedupe.
 */
export { getHooksSettings, setHooksSettings } from './settings'
export { loadAllHooks, listHooksSummary } from './load'
export { runHooks } from './run'
export { matcherMatches, expandToolNames, hookMatchesEvent } from './match'
export type {
  HookEventName,
  HookHandler,
  HooksSettings,
  HookRunInput,
  HookRunResult,
  LoadedHook,
  HookDecision
} from './types'
export { DEFAULT_HOOKS_SETTINGS, HOOK_EVENTS } from './types'
