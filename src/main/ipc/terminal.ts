import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { existsSync } from 'fs'
import { getMainWindow } from '../window'
import { clampDim, pickShell } from '../terminal'

const terminals = new Map<string, IPty>()

function isTrustedSender(event: { sender: WebContents }): boolean {
  const win = getMainWindow()
  return win !== null && event.sender === win.webContents
}

function getPtyOrReply(event: IpcMainEvent, id: string): IPty | undefined {
  const pty = terminals.get(id)
  if (!pty) event.reply('terminal:data', id, '\r\nTerminal session not found\r\n')
  return pty
}

/** Kill every live PTY; called on app quit. */
export function killAllTerminals(): void {
  terminals.forEach((pty) => {
    try { pty.kill() } catch {}
  })
  terminals.clear()
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
    pty.onData((data) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        try { win.webContents.send('terminal:data', id, data) } catch {}
      }
    })
    pty.onExit(() => { terminals.delete(id) })
    return { ok: true }
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
  })
}
