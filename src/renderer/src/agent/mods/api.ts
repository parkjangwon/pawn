import { modKvStore } from './kvStore'
import { useModsUiStore } from './uiStore'
import type { ModCommandReg, ModElementTable, ModsApi, ModToolReg } from './types'

export interface ModsApiHost {
  pluginName: string
  pluginRoot: string
  sessionId: () => string
  cwd: () => string
  getCommands: () => ModCommandReg[]
  registerCommand: (cmd: ModCommandReg) => void
  getTools: () => ModToolReg[]
  registerTool: (tool: ModToolReg) => void
  getEnv: (name: string) => string | undefined
  setEnv: (name: string, value: string) => void
  envForProcess: () => Record<string, string>
  emit: (event: string, input: unknown, core?: (e: unknown) => Promise<unknown>) => Promise<unknown>
  submitPrompt: (text: string, asUser: boolean) => void
  abortTurn: () => void
  messages: () => Array<{ role: string; text: string }>
  contextUsage: () => { tokens: number; window: number; percent: number }
  reservedCommands: Set<string>
}

const DEFAULT_ELEMENTS: ModElementTable = {
  Box: (props) => ({ type: 'Box', props }),
  Text: (props) => ({ type: 'Text', props }),
  Button: (props) => ({ type: 'Button', props }),
  Link: (props) => ({ type: 'Link', props }),
  Code: (props) => ({ type: 'Code', props }),
  Markdown: (props) => ({ type: 'Markdown', props }),
  Input: (props) => ({ type: 'Input', props }),
  Select: (props) => ({ type: 'Select', props })
}

function resolvePath(cwd: string, path: string): string {
  if (!path) return cwd
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
  const base = cwd.endsWith('/') ? cwd : cwd + '/'
  return base + path.replace(/^\.\//, '')
}

export function buildModsApi(host: ModsApiHost): ModsApi {
  const plugin = host.pluginName
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const api: ModsApi = {
    plugin: { name: plugin, root: host.pluginRoot },
    ui: {
      invalidate: () => useModsUiStore.getState().invalidate(),
      status: (text) => useModsUiStore.getState().setStatus(plugin, String(text || '')),
      toast: (text, opts) =>
        useModsUiStore.getState().pushToast(plugin, String(text || ''), opts?.timeoutMs),
      log: (text) => useModsUiStore.getState().pushLog(plugin, String(text || '')),
      notice: (text) => useModsUiStore.getState().pushNotice(plugin, String(text || ''), 'info'),
      open: (opts) => {
        useModsUiStore.getState().openPane({
          id: opts.id,
          title: opts.title || opts.id,
          plugin,
          placement: opts.placement || 'dock',
          rows: opts.rows,
          tree: (opts as { tree?: unknown }).tree
        })
      },
      close: (id) => useModsUiStore.getState().closePane(id),
      resolve: () => DEFAULT_ELEMENTS
    },
    command: {
      register: async (opts) => {
        const name = String(opts.name || '').trim()
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
          throw new Error(`Invalid command name: ${name}`)
        }
        if (host.reservedCommands.has(name.toLowerCase())) {
          throw new Error(`"/${name}" refused: it is a built-in /${name}`)
        }
        if (host.getCommands().some((c) => c.name.toLowerCase() === name.toLowerCase())) {
          throw new Error(`"/${name}" refused: already registered`)
        }
        host.registerCommand({
          name,
          description: opts.description || '',
          argumentHint: opts.argumentHint,
          immediate: opts.immediate,
          plugin
        })
      },
      run: async (opts) => {
        const result = await host.emit(
          'command.run',
          { command: opts.command, args: opts.args || '' },
          async () => ({})
        )
        return (result && typeof result === 'object' ? result : {}) as { text?: string }
      },
      list: async () => host.getCommands()
    },
    tool: {
      register: async (opts) => {
        const name = String(opts.name || '').trim()
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
          throw new Error(`Invalid tool name: ${name}`)
        }
        const fullName = `mcp__${plugin}__${name}`
        host.registerTool({
          name,
          fullName,
          description: opts.description || '',
          inputSchema: opts.inputSchema || { type: 'object', properties: {} },
          plugin,
          handler: typeof opts.handler === 'function' ? opts.handler : undefined
        })
      },
      call: async (input) => host.emit('tool.call', input, async () => ({ result: null })),
      list: async () => host.getTools()
    },
    prompt: {
      submit: async (opts) => {
        host.submitPrompt(String(opts.text || ''), opts.asUser === true)
      }
    },
    session: {
      id: () => host.sessionId(),
      cwd: () => host.cwd(),
      messages: () => host.messages(),
      usage: () => ({ context: host.contextUsage() })
    },
    fs: {
      read: async (path) => {
        const abs = resolvePath(host.cwd(), path)
        const r = await window.api?.fs?.readFile(abs)
        if (typeof r !== 'string') throw new Error(`fs.read failed: ${abs}`)
        if (r.length > 4 * 1024 * 1024) throw new Error('fs.read exceeds 4 MiB')
        return r
      },
      write: async (path, text) => {
        const abs = resolvePath(host.cwd(), path)
        const body = String(text ?? '')
        if (body.length > 4 * 1024 * 1024) throw new Error('fs.write exceeds 4 MiB')
        const r = await window.api?.fs?.writeFile(abs, body)
        if (r && typeof r === 'object' && 'error' in r && r.error) {
          throw new Error(String(r.error))
        }
      },
      exists: async (path) => {
        const abs = resolvePath(host.cwd(), path)
        const r = await window.api?.fs?.exists(abs)
        return r === true
      },
      list: async (path) => {
        const abs = resolvePath(host.cwd(), path)
        const entries = await window.api?.fs?.listDir(abs)
        if (!Array.isArray(entries)) return []
        return entries.map((e) => ({
          name: e.name,
          kind: e.isDirectory ? 'dir' : 'file',
          size: 0,
          isLink: false
        }))
      },
      stat: async (path) => {
        const abs = resolvePath(host.cwd(), path)
        const st = await window.api?.fs?.stat?.(abs)
        if (!st || typeof st !== 'object') return null
        return {
          size: Number((st as { size?: number }).size || 0),
          isFile: !!(st as { isFile?: boolean }).isFile,
          isDirectory: !!(st as { isDirectory?: boolean }).isDirectory
        }
      }
    },
    store: {
      get: (key) => modKvStore.get(plugin, key),
      set: (key, value) => modKvStore.set(plugin, key, value),
      delete: (key) => modKvStore.delete(plugin, key),
      keys: () => modKvStore.keys(plugin)
    },
    clock: {
      now: async () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
      after: (ms, fn) => {
        const id = setTimeout(() => {
          timers.delete(id)
          void Promise.resolve(fn()).catch(() => {})
        }, Math.max(0, ms))
        timers.add(id)
        return { cancel: () => { clearTimeout(id); timers.delete(id) } }
      },
      every: (ms, fn) => {
        const id = setInterval(() => {
          void Promise.resolve(fn()).catch(() => {})
        }, Math.max(1, ms))
        timers.add(id as unknown as ReturnType<typeof setTimeout>)
        return {
          cancel: () => {
            clearInterval(id)
            timers.delete(id as unknown as ReturnType<typeof setTimeout>)
          }
        }
      }
    },
    http: {
      fetch: async (url, init) => {
        const http = window.api?.mods?.http
        if (typeof http !== 'function') throw new Error(`http.fetch unavailable for ${url}`)
        const res = await http(url, init)
        if (res.error && !res.status) throw new Error(res.error)
        return {
          status: Number(res.status || 0),
          ok: res.ok === true,
          headers: res.headers || {},
          text: String(res.text || '')
        }
      }
    },
    process: {
      run: async (argv, opts) => {
        if (!Array.isArray(argv) || argv.length === 0) {
          throw new Error('process.run requires an argv array')
        }
        const cwd = opts?.cwd || host.cwd()
        const timeoutMs = Math.min(Math.max(opts?.timeoutMs || 30_000, 1), 600_000)
        const shell = window.api?.shell
        if (typeof shell?.execFile !== 'function') {
          throw new Error('process.run is only available in the desktop / headless app')
        }
        const extraEnv = host.envForProcess()
        const r = await shell.execFile(argv[0], argv.slice(1), cwd, timeoutMs, {
          enabled: true,
          network: true,
          ...(Object.keys(extraEnv).length ? { extraEnv } : {})
        })
        return {
          exitCode: Number(r?.exitCode ?? 1),
          stdout: String(r?.stdout || ''),
          stderr: String(r?.stderr || '')
        }
      }
    },
    env: {
      get: (name) => host.getEnv(String(name || '')),
      set: (name, value) => host.setEnv(String(name || ''), String(value ?? ''))
    },
    model: {
      complete: async (opts) => {
        const { modModelComplete } = await import('./modelComplete')
        return modModelComplete(opts)
      }
    },
    turn: {
      abort: () => host.abortTurn()
    }
  }

  return api
}
