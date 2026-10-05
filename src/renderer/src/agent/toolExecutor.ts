import { checkPermission } from './toolPermission'
import { getProjectTarget, isLocalOnlyTool } from './executionTarget'
import { fireHook } from './hooksClient'
import { isMcpToolName, callMcpTool } from './mcp'
import type { ToolCall, ToolResult } from './toolDefinitionsTypes'
import { TOOL_HANDLERS, type ToolExecContext } from './toolHandlers'
import { isToolAllowedInAgentMode, planModeBlockMessage } from './agentMode'
import { useProviderStore } from '../stores/provider'
import { isNativeComputerCall, nativeCallToAction } from './computerToolset'
import { effectiveToolName } from './toolIdentity'
import { currentPolicy, toToolResult } from './toolHandlers/computer'
import { getModRuntime } from './mods'
import { useModsUiStore } from './mods/uiStore'

export type { ToolExecContext } from './toolHandlers'
export { compileGlob, matchesGlob } from './globMatch'

async function executeNativeComputer(call: ToolCall, api: typeof window.api): Promise<ToolResult> {
  const exec = api.computer?.exec
  if (typeof exec !== 'function') {
    return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
  }
  const { action, args } = nativeCallToAction(call)
  if (!action) return { toolCallId: call.id, content: 'Missing computer action', isError: true }
  const res = await exec(action, args, currentPolicy())
  return toToolResult(call.id, res)
}

/** Execute a tool call and return the result. */
export async function executeTool(
  call: ToolCall,
  projectPath?: string,
  signal?: AbortSignal,
  ctx?: ToolExecContext
): Promise<ToolResult> {
  const api = window.api

  if (signal?.aborted) {
    return { toolCallId: call.id, content: 'Tool was not executed (run aborted).', isError: true }
  }

  // Remote execution target: refuse tools that would silently touch the wrong
  // machine, and point every allowed tool at the remote repo path.
  const target = getProjectTarget(ctx?.projectId)
  if (target.hostId) {
    if (isLocalOnlyTool(call.name)) {
      return {
        toolCallId: call.id,
        content: `This project executes on host "${target.hostLabel || target.hostId}". Local file/debug tools would touch the wrong machine — use shell tools (cat, tee, sed) instead.`,
        isError: true
      }
    }
    if (projectPath && target.remotePath) projectPath = target.remotePath
  }

  if (call.arguments && call.arguments.__parse_error === true) {
    return {
      toolCallId: call.id,
      content: `Invalid tool arguments for ${call.name}: ${String(call.arguments.__message || 'JSON parse failed')}\nRaw: ${String(call.arguments.__raw || '').slice(0, 300)}`,
      isError: true
    }
  }

  // Mods `tool.call` runs before settings PreToolUse / permission / execution
  // (Claude Code order). A mod may deny, answer with `{ result }`, or call next.
  const runtime = getModRuntime()
  if (ctx?.sessionId) {
    runtime.setContext({
      sessionId: ctx.sessionId,
      cwd: projectPath || '',
      projectPath: projectPath || null
    })
  }

  try {
    const modOut = await runtime.emitToolCall(
      call.name,
      { ...(call.arguments || {}), tool_use_id: call.id },
      async () => {
        if (!signal?.aborted) {
          const pre = await fireHook({
            event: 'PreToolUse',
            sessionId: ctx?.sessionId,
            projectPath: projectPath || null,
            cwd: projectPath || undefined,
            payload: {
              tool_name: call.name,
              tool_use_id: call.id,
              tool_input: call.arguments
            }
          })
          if (pre.decision === 'deny') {
            const blocked: ToolResult = {
              toolCallId: call.id,
              content: `Blocked by hook (PreToolUse): ${pre.reason || call.name}`,
              isError: true
            }
            return { result: blocked.content, isError: true, toolResult: blocked }
          }
        }

        const native = isNativeComputerCall(call)
        const permName = effectiveToolName(call)
        const agentMode = useProviderStore.getState().agentModeFor(ctx?.sessionId)
        if (!isToolAllowedInAgentMode(permName, agentMode)) {
          const blocked: ToolResult = {
            toolCallId: call.id,
            content: planModeBlockMessage(permName),
            isError: true
          }
          return { result: blocked.content, isError: true, toolResult: blocked }
        }

        const check = await runtime.emit(
          'tool.check',
          { tool: call.name, ...(call.arguments || {}) },
          async () => {
            const permitted = await checkPermission(
              permName,
              native ? nativeCallToAction(call).args : call.arguments,
              signal,
              projectPath,
              { sessionId: ctx?.sessionId, cwd: projectPath }
            )
            return { decision: permitted ? 'allow' : 'deny' }
          },
          signal
        )
        const decision =
          check && typeof check === 'object' && 'decision' in check
            ? String((check as { decision: string }).decision)
            : 'deny'
        if (decision === 'deny') {
          const blocked: ToolResult = {
            toolCallId: call.id,
            content: `Permission denied: ${call.name}`,
            isError: true
          }
          return { result: blocked.content, isError: true, toolResult: blocked }
        }
        if (signal?.aborted) {
          const blocked: ToolResult = {
            toolCallId: call.id,
            content: 'Tool was not executed (run aborted).',
            isError: true
          }
          return { result: blocked.content, isError: true, toolResult: blocked }
        }

        let result: ToolResult
        const modTool = runtime.getTools().find((t) => t.fullName === call.name)
        if (modTool) {
          if (typeof modTool.handler !== 'function') {
            result = {
              toolCallId: call.id,
              content: `Mod tool ${call.name} is registered without a handler.`,
              isError: true
            }
          } else {
            try {
              const raw = await modTool.handler({ ...(call.arguments || {}) })
              const content =
                typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)
              result = { toolCallId: call.id, content, isError: false }
            } catch (err) {
              result = {
                toolCallId: call.id,
                content: err instanceof Error ? err.message : String(err),
                isError: true
              }
            }
          }
        } else if (native) {
          result = await executeNativeComputer(call, api)
        } else if (isMcpToolName(call.name)) {
          result = await callMcpTool(call.id, call.name, call.arguments, projectPath)
        } else {
          const handler = TOOL_HANDLERS[call.name]
          if (!handler) {
            result = { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true }
          } else {
            result = await handler(call, projectPath, signal, ctx, api)
          }
        }
        void runtime.refreshSpinnerSuffix().catch(() => {})
        return { result: result.content, isError: result.isError, toolResult: result }
      },
      signal
    )

    if (modOut.deny) {
      const plugin = modOut.plugin || 'extension'
      useModsUiStore.getState().pushNotice(plugin, modOut.deny, 'block')
      return {
        toolCallId: call.id,
        content: `Blocked by extension (${plugin}): ${modOut.deny}`,
        isError: true,
        mod: { plugin, action: 'blocked' }
      }
    }

    if (modOut.handled) {
      const plugin = modOut.plugin || 'extension'
      useModsUiStore.getState().pushNotice(plugin, `Answered ${call.name}`, 'answer')
      return {
        toolCallId: call.id,
        content: modOut.result || '',
        isError: modOut.isError === true,
        mod: { plugin, action: 'answered' }
      }
    }

    const result: ToolResult =
      modOut.core?.toolResult ||
      ({
        toolCallId: call.id,
        content: modOut.result || '',
        isError: modOut.isError === true
      } as ToolResult)

    if (signal?.aborted && !result.isError) {
      return {
        ...result,
        content: `${result.content}\n(note: run was aborted after this tool finished)`
      }
    }

    if (!signal?.aborted && window.api?.hooks?.run) {
      void fireHook({
        event: 'PostToolUse',
        sessionId: ctx?.sessionId,
        projectPath: projectPath || null,
        cwd: projectPath || undefined,
        payload: {
          tool_name: call.name,
          tool_use_id: call.id,
          tool_input: call.arguments,
          tool_response: {
            content: String(result.content || '').slice(0, 8000),
            isError: result.isError === true
          }
        }
      })
    }
    return result
  } catch (err) {
    return {
      toolCallId: call.id,
      content: `Tool error (${call.name}): ${String(err)}`,
      isError: true
    }
  }
}
