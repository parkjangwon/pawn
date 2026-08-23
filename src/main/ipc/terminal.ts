import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { existsSync } from 'fs'
import { isTrustedSender } from './trust'
import { clampDim, pickShell } from '../terminal'

const terminals = new Map<string, IPty>()
/** Rolling output buffer per terminal (for agent terminal_read). */
const terminalBuffers = new Map<string, string>()
/** When a PTY exits, keep its buffer briefly then drop (ms). */
const deadBufferTimers = new Map<string, ReturnType<typeof setTimeout>>()
const MAX_BUFFER_CHARS = 80_000
const MAX_TERMINALS = 12
const DEAD_BUFFER_TTL_MS = 5 * 60 * 1000

function getPtyOrReply(event: IpcMainEvent, id: string): IPty | undefined {
  const pty = terminals.get(id)
  if (!pty) {
    try {
      event.reply('terminal:data', id, '\r\nTerminal session not found\r\n')
    } catch {
      /* sender gone */
    }
  }
  return pty
}

function appendBuffer(id: string, data: string): void {
  const prev = terminalBuffers.get(id) || ''
  const next = prev + data
  terminalBuffers.set(id, next.length > MAX_BUFFER_CHARS ? next.slice(-MAX_BUFFER_CHARS) : next)
}

function clearDeadTimer(id: string): void {
  const t = deadBufferTimers.get(id)
  if (t) {
    clearTimeout(t)
    deadBufferTimers.delete(id)
  }
}

function scheduleDeadBufferDrop(id: string): void {
  clearDeadTimer(id)
  deadBufferTimers.set(
    id,
    setTimeout(() => {
      deadBufferTimers.delete(id)
      if (!terminals.has(id)) terminalBuffers.delete(id)
    }, DEAD_BUFFER_TTL_MS)
  )
}

/** Kill every live PTY; called on app quit. */
export function killAllTerminals(): void {
  terminals.forEach((pty) => {
    try {
      pty.kill()
    } catch {
      /* ignore */
    }
  })
  terminals.clear()
  terminalBuffers.clear()
  Array.from(deadBufferTimers.values()).forEach((t) => clearTimeout(t))
  deadBufferTimers.clear()
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:create', (event, id, cols, rows, cwd) => {
    try {
      if (!isTrustedSender(event) || typeof id !== 'string' || !id.trim()) {
        return { ok: false, error: 'Invalid request' }
      }
      if (id.includes('\0')) return { ok: false, error: 'Invalid terminal id' }
      const cwdStr = typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
      if (cwdStr.includes('\0') || !existsSync(cwdStr)) {
        return { ok: false, error: `Directory not found: ${cwdStr}` }
      }

      const existing = terminals.get(id)
      if (existing) {
        try {
          existing.kill()
        } catch {
          /* ignore */
        }
        terminals.delete(id)
        clearDeadTimer(id)
      } else if (terminals.size >= MAX_TERMINALS) {
        return {
          ok: false,
          error: `Too many terminals (max ${MAX_TERMINALS}). Close one before opening another.`
        }
      }

      const shell = pickShell()
      const pty = spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: clampDim(cols, 80),
        rows: clampDim(rows, 24),
        cwd: cwdStr,
        env: { ...process.env, TERM: 'xterm-256color' }
      })

      terminals.set(id, pty)
      terminalBuffers.set(id, '')
      clearDeadTimer(id)

      let pendingData = ''
      let flushTimer: NodeJS.Timeout | null = null

      const flush = (): void => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        if (!pendingData) return
        const chunk = pendingData
        pendingData = ''
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed()) continue
          try {
            win.webContents.send('terminal:data', id, chunk)
          } catch {
            /* ignore */
          }
        }
      }

      pty.onData((data) => {
        appendBuffer(id, data)
        pendingData += data
        if (pendingData.length >= 4096) {
          flush()
        } else if (!flushTimer) {
          flushTimer = setTimeout(flush, 16)
        }
      })
      pty.onExit(() => {
        flush()
        terminals.delete(id)
        // Keep buffer briefly so agent can still read after exit.
        scheduleDeadBufferDrop(id)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('terminal:list', (event) => {
    try {
      if (!isTrustedSender(event)) return { ok: false, error: 'Invalid request', terminals: [] }
      const list = Array.from(terminals.keys()).map((id) => ({
        id,
        bufferChars: (terminalBuffers.get(id) || '').length,
        alive: true
      }))
      Array.from(terminalBuffers.entries()).forEach(([id, buf]) => {
        if (!terminals.has(id) && buf) {
          list.push({ id, bufferChars: buf.length, alive: false })
        }
      })
      return { ok: true, terminals: list }
    } catch (err) {
      return { ok: false, error: String(err), terminals: [] }
    }
  })

  ipcMain.handle('terminal:readBuffer', (event, id: string, maxChars?: number) => {
    try {
      if (!isTrustedSender(event) || typeof id !== 'string') {
        return { ok: false, error: 'Invalid request' }
      }
      const buf = terminalBuffers.get(id)
      if (buf === undefined) {
        return {
          ok: false,
          error: `No terminal buffer for id=${id}. Open a terminal panel first, or pass a known id from terminal_list.`
        }
      }
      const cap = Math.min(Math.max(Number(maxChars) || 20_000, 500), MAX_BUFFER_CHARS)
      const text = buf.length > cap ? buf.slice(-cap) : buf
      const plain = text
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
      return {
        ok: true,
        id,
        alive: terminals.has(id),
        text: plain,
        rawChars: buf.length,
        returnedChars: plain.length
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.on('terminal:write', (event, id, data) => {
    if (!isTrustedSender(event) || typeof id !== 'string' || typeof data !== 'string') return
    const pty = getPtyOrReply(event, id)
    if (!pty) return
    try {
      pty.write(data.slice(0, 256 * 1024))
    } catch {
      /* ignore */
    }
  })

  ipcMain.on('terminal:resize', (event, id, cols, rows) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return
    const pty = getPtyOrReply(event, id)
    if (!pty) return
    try {
      pty.resize(clampDim(cols, 80), clampDim(rows, 24))
    } catch {
      /* ignore */
    }
  })

  ipcMain.on('terminal:dispose', (event, id) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return
    const pty = terminals.get(id)
    if (pty) {
      try {
        pty.kill()
      } catch {
        /* ignore */
      }
      terminals.delete(id)
    }
    clearDeadTimer(id)
    terminalBuffers.delete(id)
  })
}
