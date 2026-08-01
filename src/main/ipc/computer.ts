import { desktopCapturer, ipcMain } from 'electron'
import { handleTrusted } from './trust'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export function registerComputerIpc(): void {
  handleTrusted('computer:screenshot', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      if (sources.length === 0) return { error: 'No screen sources' }
      return { dataUrl: sources[0].thumbnail.toDataURL() }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('computer:click', async (_, x: number, y: number) => {
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('cliclick', [`c:${x},${y}`])
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['mousemove', String(x), String(y), 'click', '1'])
      } else {
        return { error: 'Unsupported platform' }
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('computer:type', async (_, text: string) => {
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('cliclick', [`t:${text}`])
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['type', '--', text])
      } else {
        return { error: 'Unsupported platform' }
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handleTrusted('computer:keypress', async (_, key: string) => {
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('cliclick', [`kp:${key}`])
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['key', key])
      } else {
        return { error: 'Unsupported platform' }
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
