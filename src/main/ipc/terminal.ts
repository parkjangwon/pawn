import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { existsSync } from 'fs'
import { getMainWindow } from '../window'
import { clampDim, pickShell } from '../terminal'

const terminals = new Map<string, IPty>()
/** Rolling output buffer per terminal (for agent terminal_read). */
const terminalBuffers = new Map<string, string>()
const MAX_BUFFER_CHARS = 80_000

function isTrustedSender(event: { sender: WebContents }): boolean {
  const win = getMainWindow()
  return win !== null && event.sender === win.webContents
}

function getPtyOrReply(event: IpcMainEvent, id: string): IPty | undefined {
  const pty = terminals.get(id)
  if (!pty) event.reply('terminal:data', id, '\r\nTerminal session not found\r\n')
  return pty
}

function appendBuffer(id: string, data: string): void {
  const prev = terminalBuffers.get(id) || ''
  const next = prev + data
  terminalBuffers.set(id, next.length > MAX_BUFFER_CHARS ? next.slice(-MAX_BUFFER_CHARS) : next)
}

/** Kill every live PTY; called on app quit. */
export function killAllTerminals(): void {
  terminals.forEach((pty) => {
    try { pty.kill() } catch {}
  })
  terminals.clear()
  terminalBuffers.clear()
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:create', (event, id, cols, rows, cwd) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return { ok: false, error: 'Invalid request' }
    const cwdStr = typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
    if (!existsSync(cwdStr)) return { ok: false, error: `Directory not found: ${cwdStr}` }

    const existing = terminals.get(id)
    if (existing) {
      try { existing.kill() } catch {}
      terminals.delete(id)
    }

    const shell = pickShell()
    let pty: IPty
    try {
      pty = spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: clampDim(cols, 80),
        rows: clampDim(rows, 24),
        cwd: cwdStr,
        env: { ...process.env, TERM: 'xterm-256color' }
      })
    } catch (err) {
      return { ok: false, error: String(err) }
    }

    terminals.set(id, pty)
    terminalBuffers.set(id, '')
    pty.onData((data) => {
      appendBuffer(id, data)
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        try { win.webContents.send('terminal:data', id, data) } catch {}
      }
    })
    pty.onExit(() => {
      terminals.delete(id)
      // keep buffer briefly so agent can still read after exit; drop after dispose
    })
    return { ok: true }
  })

  ipcMain.handle('terminal:list', (event) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Invalid request', terminals: [] }
    const list = Array.from(terminals.keys()).map((id) => ({
      id,
      bufferChars: (terminalBuffers.get(id) || '').length,
      alive: true
    }))
    // Also surface buffers whose PTY exited but buffer remains
    Array.from(terminalBuffers.entries()).forEach(([id, buf]) => {
      if (!terminals.has(id) && buf) {
        list.push({ id, bufferChars: buf.length, alive: false })
      }
    })
    return { ok: true, terminals: list }
  })

  ipcMain.handle('terminal:readBuffer', (event, id: string, maxChars?: number) => {
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
    // Strip common ANSI CSI sequences for agent readability
    const plain = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
    return {
      ok: true,
      id,
      alive: terminals.has(id),
      text: plain,
      rawChars: buf.length,
      returnedChars: plain.length
    }
  })

  ipcMain.on('terminal:write', (event, id, data) => {
    if (!isTrustedSender(event) || typeof id !== 'string' || typeof data !== 'string') return
    const pty = getPtyOrReply(event, id)
    if (!pty) return
    try { pty.write(data.slice(0, 1024 * 1024)) } catch {}
  })

  ipcMain.on('terminal:resize', (event, id, cols, rows) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return
    const pty = getPtyOrReply(event, id)
    if (!pty) return
    try { pty.resize(clampDim(cols, 80), clampDim(rows, 24)) } catch {}
  })

  ipcMain.on('terminal:dispose', (event, id) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return
    const pty = terminals.get(id)
    if (pty) {
      try { pty.kill() } catch {}
      terminals.delete(id)
    }
    terminalBuffers.delete(id)
  })
}
