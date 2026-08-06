import type { ToolHandler } from './types'


const computer_screenshot: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.screenshot) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.screenshot({
          displayId: call.arguments.display_id != null ? Number(call.arguments.display_id) : undefined,
          maxWidth: call.arguments.max_width != null ? Number(call.arguments.max_width) : undefined
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        const meta = [
          `display=${result.displayId ?? '?'} ${result.displayLabel || ''}`.trim(),
          `image=${result.width}x${result.height}`,
          `screen=${result.screenWidth}x${result.screenHeight}`,
          `scaleFactor=${result.scaleFactor ?? 1}`,
          'coord_space=image (top-left). Use same space for computer_click/drag/scroll unless coord_space=screen.'
        ].join('\n')
        // Meta text + data URL: transcript maps the data URL to a vision image block.
        return {
          toolCallId: call.id,
          content: `${meta}\n${result.dataUrl || ''}`
        }
      }


const computer_displays: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.displays) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const res = await api.computer.displays()
        const list = res.displays || []
        if (!list.length) return { toolCallId: call.id, content: 'No displays found.', isError: true }
        const lines = list.map(
          (d) =>
            `- id=${d.id}${d.primary ? ' (primary)' : ''}: ${d.label} ${d.width}x${d.height}`
        )
        return { toolCallId: call.id, content: `# Displays\n${lines.join('\n')}` }
      }


const computer_click: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.click) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.click(Number(call.arguments.x), Number(call.arguments.y), {
          button: call.arguments.button != null ? String(call.arguments.button) : undefined,
          clicks: call.arguments.clicks != null ? Number(call.arguments.clicks) : undefined,
          coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined,
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return {
          toolCallId: call.id,
          content: `Clicked (${result.x}, ${result.y}) button=${call.arguments.button || 'left'} clicks=${call.arguments.clicks || 1}`
        }
      }


const computer_move: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.move) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.move(Number(call.arguments.x), Number(call.arguments.y), {
          coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        return { toolCallId: call.id, content: `Moved mouse to (${result.x}, ${result.y})` }
      }


const computer_drag: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.drag) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.drag(
          Number(call.arguments.from_x),
          Number(call.arguments.from_y),
          Number(call.arguments.to_x),
          Number(call.arguments.to_y),
          {
            button: call.arguments.button != null ? String(call.arguments.button) : undefined,
            steps: call.arguments.steps != null ? Number(call.arguments.steps) : undefined,
            coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined,
            returnScreenshot: call.arguments.return_screenshot === true
          }
        )
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return {
          toolCallId: call.id,
          content: `Dragged (${call.arguments.from_x},${call.arguments.from_y}) → (${call.arguments.to_x},${call.arguments.to_y})`
        }
      }


const computer_scroll: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.scroll) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const result = await api.computer.scroll(Number(call.arguments.x), Number(call.arguments.y), {
          dy: call.arguments.dy != null ? Number(call.arguments.dy) : undefined,
          dx: call.arguments.dx != null ? Number(call.arguments.dx) : undefined,
          coordSpace: call.arguments.coord_space != null ? String(call.arguments.coord_space) : undefined,
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return {
          toolCallId: call.id,
          content: `Scrolled at (${call.arguments.x},${call.arguments.y}) dy=${call.arguments.dy ?? 0} dx=${call.arguments.dx ?? 0}`
        }
      }


const computer_type: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.type) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const text = String(call.arguments.text || '')
        const result = await api.computer.type(text, {
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return { toolCallId: call.id, content: `Typed ${text.length} chars` }
      }


const computer_keypress: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.keypress) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const key = String(call.arguments.key || '')
        if (!key) return { toolCallId: call.id, content: 'key is required', isError: true }
        const result = await api.computer.keypress(key, {
          returnScreenshot: call.arguments.return_screenshot === true
        })
        if (result.error) return { toolCallId: call.id, content: result.error, isError: true }
        if (result.screenshot) return { toolCallId: call.id, content: result.screenshot }
        return { toolCallId: call.id, content: `Pressed key: ${key}` }
      }


const computer_clipboard: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.clipboard) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const action = String(call.arguments.action || 'get')
        const res = await api.computer.clipboard(
          action,
          call.arguments.text != null ? String(call.arguments.text) : undefined
        )
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        if (action === 'get' || action === 'read') {
          return { toolCallId: call.id, content: res.text ?? '' }
        }
        return { toolCallId: call.id, content: 'Clipboard updated' }
      }


const computer_wait: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        if (!api.computer?.wait) {
          return { toolCallId: call.id, content: 'Computer use is only available in the desktop app.', isError: true }
        }
        const ms = Number(call.arguments.ms)
        const res = await api.computer.wait(ms)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: `Waited ${res.ms}ms` }
      }


export const computerHandlers: Record<string, ToolHandler> = {
  'computer_screenshot': computer_screenshot,
  'computer_displays': computer_displays,
  'computer_click': computer_click,
  'computer_move': computer_move,
  'computer_drag': computer_drag,
  'computer_scroll': computer_scroll,
  'computer_type': computer_type,
  'computer_keypress': computer_keypress,
  'computer_clipboard': computer_clipboard,
  'computer_wait': computer_wait,
}
