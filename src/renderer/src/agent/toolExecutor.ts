import { checkPermission } from './toolPermission'
import { fireHook } from './hooksClient'
import { isMcpToolName, callMcpTool } from './mcp'
import type { ToolCall, ToolResult } from './toolDefinitionsTypes'
import { TOOL_HANDLERS, type ToolExecContext } from './toolHandlers'

export type { ToolExecContext } from './toolHandlers'
export { compileGlob, matchesGlob } from './globMatch'

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

  if (call.arguments && call.arguments.__parse_error === true) {
    return {
      toolCallId: call.id,
      content: `Invalid tool arguments for ${call.name}: ${String(call.arguments.__message || 'JSON parse failed')}\nRaw: ${String(call.arguments.__raw || '').slice(0, 300)}`,
      isError: true
    }
  }

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
      return {
        toolCallId: call.id,
        content: `Blocked by hook (PreToolUse): ${pre.reason || call.name}`,
        isError: true
      }
    }
  }

  const permitted = await checkPermission(call.name, call.arguments, signal, projectPath, {
    sessionId: ctx?.sessionId,
    cwd: projectPath
  })
  if (!permitted) {
    return { toolCallId: call.id, content: `Permission denied: ${call.name}`, isError: true }
  }

  try {
    let result: ToolResult
    if (isMcpToolName(call.name)) {
      result = await callMcpTool(call.id, call.name, call.arguments, projectPath)
    } else {
      const handler = TOOL_HANDLERS[call.name]
      if (!handler) {
        result = { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true }
      } else {
        result = await handler(call, projectPath, signal, ctx, api)
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
