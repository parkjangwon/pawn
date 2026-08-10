import { requireBrowser } from './browserHelpers'
import type { ToolHandler } from './types'


const browser_navigate: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.navigate(call.arguments.url as string)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return {
          toolCallId: call.id,
          content: `Loaded ${res.url}\nTitle: ${res.title || '(none)'}\n\nCall browser_snapshot to see the interactive elements.`
        }
      }


const browser_snapshot: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.snapshot((call.arguments.filter as string) || '')
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        if (res.elements.length === 0) {
          return { toolCallId: call.id, content: `${res.url}\nNo interactive elements matched. The page may still be loading, or the content may be inside a cross-origin frame.` }
        }
        const lines = res.elements.map((e) => {
          const bits = [`[${e.ref}]`, e.role]
          if (e.text) bits.push(JSON.stringify(e.text))
          if (e.name) bits.push(`name=${e.name}`)
          if (e.placeholder) bits.push(`placeholder=${JSON.stringify(e.placeholder)}`)
          if (e.value) bits.push(`value=${JSON.stringify(e.value)}`)
          if (e.href) bits.push(`href=${e.href}`)
          return bits.join(' ')
        })
        return {
          toolCallId: call.id,
          content: `${res.title}\n${res.url}\n\n${lines.join('\n')}${res.truncated ? '\n...(more elements omitted; pass a filter to narrow)' : ''}`
        }
      }


const browser_click: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.click(call.arguments.ref as string, call.arguments.selector as string)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.message }
      }


const browser_fill: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.fill(
          call.arguments.ref as string,
          call.arguments.selector as string,
          String(call.arguments.value ?? ''),
          call.arguments.submit === true
        )
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.message }
      }


const browser_read_text: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.readText((call.arguments.selector as string) || '')
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.text || '(no visible text)' }
      }


const browser_eval: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.evaluate(call.arguments.code as string)
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: res.result }
      }


const browser_back: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.back()
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        return { toolCallId: call.id, content: `Went back to ${res.url}` }
      }


const browser_screenshot: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        const b = await requireBrowser(ctx)
        if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
        const res = await b.agent.screenshot()
        if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
        // Return data URL so transcript maps it to a vision image block (same as computer_screenshot).
        if (res.dataUrl && res.dataUrl.startsWith('data:image/')) {
          return { toolCallId: call.id, content: res.dataUrl }
        }
        return {
          toolCallId: call.id,
          content: `[Screenshot captured, ${res.bytes} bytes — no image data returned]`
        }
      }


const browser_open_external: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
        await api.browser.open(call.arguments.url as string)
        return { toolCallId: call.id, content: `Opened in the system browser: ${call.arguments.url}` }
      }

const browser_wait: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const b = await requireBrowser(ctx)
  if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
  const res = await b.agent.wait({
    ms: call.arguments.ms != null ? Number(call.arguments.ms) : undefined,
    selector: call.arguments.selector != null ? String(call.arguments.selector) : undefined,
    text: call.arguments.text != null ? String(call.arguments.text) : undefined,
    timeoutMs:
      call.arguments.timeout_ms != null ? Number(call.arguments.timeout_ms) : undefined
  })
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  return { toolCallId: call.id, content: `Waited ${res.waitedMs ?? 0}ms` }
}

const browser_scroll: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const b = await requireBrowser(ctx)
  if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
  const res = await b.agent.scroll({
    dy: call.arguments.dy != null ? Number(call.arguments.dy) : undefined,
    dx: call.arguments.dx != null ? Number(call.arguments.dx) : undefined,
    selector: call.arguments.selector != null ? String(call.arguments.selector) : undefined
  })
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  return {
    toolCallId: call.id,
    content: `Scrolled dy=${call.arguments.dy ?? 0} dx=${call.arguments.dx ?? 0}`
  }
}

const browser_select: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const b = await requireBrowser(ctx)
  if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
  const res = await b.agent.select({
    ref: call.arguments.ref != null ? String(call.arguments.ref) : undefined,
    selector: call.arguments.selector != null ? String(call.arguments.selector) : undefined,
    value: String(call.arguments.value ?? '')
  })
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  return { toolCallId: call.id, content: res.message || 'Selected' }
}

const browser_tab_new: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const b = await requireBrowser(ctx)
  if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
  const url = call.arguments.url != null ? String(call.arguments.url) : undefined
  const res = await b.agent.tabNew(url)
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  // For subagent runs the tab is owner-scoped (parked); prefer the explicit
  // tabId the main process returned (reuse path included).
  const created = res.tabs.find((t) => t.id === res.tabId) || res.tabs[res.tabs.length - 1]
  const label = created?.title || created?.url || 'new tab'
  const id = res.tabId || created?.id || res.activeTabId || ''
  const activeNote = ctx?.subagent
    ? 'It is bound to this run (it stays in the background tab bar).'
    : 'It is now the active tab.'
  return {
    toolCallId: call.id,
    content: `Opened a new tab (${id}) — ${label}. ${activeNote} Call browser_snapshot to see its elements.`
  }
}

const browser_tab_list: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const b = await requireBrowser(ctx)
  if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
  const res = await b.agent.tabs()
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  if (res.tabs.length === 0) {
    return { toolCallId: call.id, content: 'No browser tabs open. Use browser_navigate or browser_tab_new first.' }
  }
  const lines = res.tabs.map((t) => {
    const marker = t.id === res.activeTabId ? '* ' : '  '
    const title = t.title ? ` "${t.title}"` : ''
    const url = t.url ? ` ${t.url}` : ' (blank)'
    return `${marker}[${t.id}]${title}${url}`
  })
  return { toolCallId: call.id, content: `Tabs (active marked *):\n${lines.join('\n')}` }
}

const browser_tab_switch: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const b = await requireBrowser(ctx)
  if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
  const id = String(call.arguments.tab_id ?? '')
  if (!id) return { toolCallId: call.id, content: 'Missing tab_id', isError: true }
  const res = await b.agent.tabSwitch(id)
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  return {
    toolCallId: call.id,
    content: `Switched to tab ${id}. Call browser_snapshot to see the active page.`
  }
}

const browser_tab_close: ToolHandler = async (call, projectPath, _signal, ctx, api) => {
  const b = await requireBrowser(ctx)
  if ('error' in b) return { toolCallId: call.id, content: b.error, isError: true }
  const id = String(call.arguments.tab_id ?? '')
  if (!id) return { toolCallId: call.id, content: 'Missing tab_id', isError: true }
  const res = await b.agent.tabClose(id)
  if (res.error) return { toolCallId: call.id, content: res.error, isError: true }
  return { toolCallId: call.id, content: `Closed tab ${id}.` }
}

export const browserHandlers: Record<string, ToolHandler> = {
  'browser_navigate': browser_navigate,
  'browser_snapshot': browser_snapshot,
  'browser_click': browser_click,
  'browser_fill': browser_fill,
  'browser_read_text': browser_read_text,
  'browser_eval': browser_eval,
  'browser_back': browser_back,
  'browser_screenshot': browser_screenshot,
  'browser_open_external': browser_open_external,
  'browser_wait': browser_wait,
  'browser_scroll': browser_scroll,
  'browser_select': browser_select,
  'browser_tab_new': browser_tab_new,
  'browser_tab_list': browser_tab_list,
  'browser_tab_switch': browser_tab_switch,
  'browser_tab_close': browser_tab_close,
}
