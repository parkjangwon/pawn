import type { ToolHandler } from './types'
import type { ToolCall, ToolResult } from '../toolDefinitionsTypes'
import { useProviderStore } from '../../stores/provider'
import { claudeModelVersion } from '../computerToolset'

/**
 * Computer-use tool handlers. Every tool maps to one engine action executed
 * in the main process (native macOS helper, or the legacy path on other
 * platforms) through window.api.computer.exec.
 */

type Api = typeof window.api
type Args = Record<string, unknown>

const UNAVAILABLE = 'Computer use is only available in the desktop app.'

/** Screenshot size policy for the model that will look at the image. */
export function shotPolicyFor(modelId: string | undefined): { maxLongEdge: number; maxPixels: number } {
  const id = (modelId || '').toLowerCase()
  // High-resolution vision tiers: Claude Opus 4.7+ and every 5.x model
  // (2576 px / ~3.75 MP), GPT-5.x, Gemini 2.5+/3. Older Claude models reject
  // images over 1568 px on the long edge, so they get the standard tier.
  const claude = claudeModelVersion(id)
  const highRes = claude
    ? claude.version >= 5 || (claude.family === 'opus' && claude.version >= 4.7)
    : /(^|\/)gpt-5/.test(id) || /gemini-(2\.5|3)/.test(id)
  return highRes ? { maxLongEdge: 1920, maxPixels: 3_000_000 } : { maxLongEdge: 1568, maxPixels: 1_150_000 }
}

/**
 * The model that will read the next screenshot: the one the router actually
 * called last (callLLM notes it). Falls back to the manually selected model.
 * Must match what llm.ts declares to Claude as display_width/height.
 */
let routedModelId: string | undefined

export function noteComputerModel(modelId: string | undefined): void {
  routedModelId = modelId
}

export function currentPolicy(): { maxLongEdge: number; maxPixels: number } {
  if (routedModelId) return shotPolicyFor(routedModelId)
  try {
    const st = useProviderStore.getState()
    const model = st.models.find((m) => m.id === st.activeModelId)
    return shotPolicyFor(model?.modelId)
  } catch {
    return shotPolicyFor(undefined)
  }
}

/** Tool result text + optional image data URL (transcript maps it to a vision block). */
export function toToolResult(callId: string, res: ComputerResultDto): ToolResult {
  const content = res.image ? `${res.text}\n${res.image.dataUrl}` : res.text
  return { toolCallId: callId, content, isError: !res.ok }
}

async function exec(api: Api, call: ToolCall, action: string, args: Args): Promise<ToolResult> {
  const c = api.computer
  if (!c) return { toolCallId: call.id, content: UNAVAILABLE, isError: true }
  if (typeof c.exec === 'function') {
    const res = await c.exec(action, args, currentPolicy())
    return toToolResult(call.id, res)
  }
  return legacy(api, call, action, args)
}

/** Pre-exec desktop builds / web preview: the original per-action IPC. */
async function legacy(api: Api, call: ToolCall, action: string, args: Args): Promise<ToolResult> {
  const c = api.computer
  const fail = (m: string): ToolResult => ({ toolCallId: call.id, content: m, isError: true })
  const pt = Array.isArray(args.coordinate)
    ? (args.coordinate as number[])
    : typeof args.x === 'number' && typeof args.y === 'number'
      ? [args.x, args.y]
      : undefined
  switch (action) {
    case 'screenshot': {
      const r = await c.screenshot({ maxWidth: 1568, displayId: typeof args.display_id === 'number' ? args.display_id : undefined })
      if (r.error) return fail(r.error)
      return { toolCallId: call.id, content: `screenshot ${r.width}x${r.height}\n${r.dataUrl || ''}` }
    }
    case 'click': {
      if (!pt) return fail('coordinate [x, y] is required')
      const r = await c.click(pt[0], pt[1], { button: args.button as string, clicks: args.clicks as number, returnScreenshot: args.return_screenshot === true })
      if (r.error) return fail(r.error)
      return { toolCallId: call.id, content: r.screenshot || `Clicked (${pt[0]}, ${pt[1]})` }
    }
    case 'move': {
      if (!pt) return fail('coordinate [x, y] is required')
      const r = await c.move(pt[0], pt[1])
      return r.error ? fail(r.error) : { toolCallId: call.id, content: `Moved to (${pt[0]}, ${pt[1]})` }
    }
    case 'drag': {
      const a = args.from as number[] | undefined
      const b = args.to as number[] | undefined
      if (!a || !b) return fail('from and to are required')
      const r = await c.drag(a[0], a[1], b[0], b[1], { button: args.button as string })
      return r.error ? fail(r.error) : { toolCallId: call.id, content: 'Dragged' }
    }
    case 'scroll': {
      const amount = Number(args.amount) || 3
      const dir = String(args.direction || 'down')
      const r = await c.scroll(pt?.[0] ?? 0, pt?.[1] ?? 0, {
        dy: dir === 'down' ? amount : dir === 'up' ? -amount : 0,
        dx: dir === 'right' ? amount : dir === 'left' ? -amount : 0
      })
      return r.error ? fail(r.error) : { toolCallId: call.id, content: 'Scrolled' }
    }
    case 'type': {
      const r = await c.type(String(args.text ?? ''))
      return r.error ? fail(r.error) : { toolCallId: call.id, content: 'Typed' }
    }
    case 'key': {
      const r = await c.keypress(String(args.key ?? ''))
      return r.error ? fail(r.error) : { toolCallId: call.id, content: `Pressed ${args.key}` }
    }
    case 'clipboard': {
      const r = await c.clipboard(String(args.action || 'get'), args.text != null ? String(args.text) : undefined)
      return r.error ? fail(r.error) : { toolCallId: call.id, content: r.text ?? 'Clipboard updated' }
    }
    case 'wait': {
      const r = await c.wait(Number(args.ms) || 1000)
      return r.error ? fail(r.error) : { toolCallId: call.id, content: `Waited ${r.ms} ms` }
    }
    case 'displays': {
      const r = await c.displays()
      return { toolCallId: call.id, content: (r.displays || []).map((d) => `- id=${d.id} ${d.label} ${d.width}x${d.height}${d.primary ? ' (primary)' : ''}`).join('\n') }
    }
    default:
      return fail(`${action} needs a newer Pawn desktop build.`)
  }
}

function h(action: string, map?: (a: Args) => Args): ToolHandler {
  return (call, _projectPath, _signal, _ctx, api) => exec(api, call, action, map ? map(call.arguments) : call.arguments)
}

const computer_status: ToolHandler = async (call, _p, _s, _c, api) => {
  const c = api.computer
  if (!c) return { toolCallId: call.id, content: UNAVAILABLE, isError: true }
  const res = c.status ? await c.status({ prompt: call.arguments.prompt === true }) : await c.preflight()
  const lines = [
    `# Computer use — ${res.ok ? 'ready' : 'needs setup'}`,
    `platform: ${res.platform}${'backend' in res ? ` · backend: ${res.backend}` : ''}`,
    ...(res.notes || []).map((n: string) => `- ${n}`),
    ...(res.errors || []).map((e: string) => `! ${e}`)
  ]
  return { toolCallId: call.id, content: lines.join('\n'), isError: !res.ok }
}

export const computerHandlers: Record<string, ToolHandler> = {
  computer_screenshot: h('screenshot'),
  computer_zoom: h('zoom'),
  computer_click: h('click'),
  computer_type: h('type'),
  computer_key: h('key'),
  computer_scroll: h('scroll'),
  computer_drag: h('drag'),
  computer_mouse: (call, _projectPath, _signal, _ctx, api) => {
    const a = call.arguments
    const sub = String(a.action || 'move').toLowerCase()
    const action = sub === 'down' ? 'mouse_down' : sub === 'up' ? 'mouse_up' : sub === 'cursor' || sub === 'position' ? 'cursor' : 'move'
    return exec(api, call, action, a)
  },
  computer_hold_key: h('hold_key'),
  // Names from earlier Pawn versions (automations, custom agent configs).
  computer_keypress: h('key'),
  computer_move: h('move'),
  computer_ui_snapshot: h('ui_snapshot'),
  computer_ui_action: h('ui_action'),
  computer_find: h('find'),
  computer_ocr: h('ocr'),
  computer_apps: h('apps'),
  computer_windows: h('windows'),
  computer_menu: h('menu'),
  computer_open: h('open'),
  computer_clipboard: h('clipboard'),
  computer_wait: h('wait', (a) => ({ ...a, ...(a.seconds != null ? { duration: a.seconds } : {}) })),
  computer_displays: h('displays'),
  computer_status
}
