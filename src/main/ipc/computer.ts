import { desktopCapturer, screen } from 'electron'
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
        try {
          await execFileAsync('cliclick', [`c:${x},${y}`])
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            return { error: 'cliclick is required for OS-level clicking on macOS. Please install it using "brew install cliclick"' }
          }
          throw err;
        }
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['mousemove', String(x), String(y), 'click', '1'])
      } else if (process.platform === 'win32') {
        const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1
        const physicalX = Math.round(x * scaleFactor)
        const physicalY = Math.round(y * scaleFactor)
        const typeId = `Win32Mouse_${Date.now()}_${Math.floor(Math.random() * 1000)}`
        const command = `[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);`
        const powershellCmd = `$sig = '${command}'; $type = Add-Type -MemberDefinition $sig -Name "${typeId}" -Namespace "Win32" -PassThru; [void]$type::SetCursorPos(${physicalX}, ${physicalY}); $type::mouse_event(0x0002, 0, 0, 0, 0); $type::mouse_event(0x0004, 0, 0, 0, 0);`
        await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershellCmd])
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
        try {
          await execFileAsync('cliclick', [`t:${text}`])
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\r')
            await execFileAsync('osascript', ['-e', `tell application "System Events" to keystroke "${escaped}"`])
          } else {
            throw err
          }
        }
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['type', '--', text])
      } else if (process.platform === 'win32') {
        const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}')
        const command = `[System.Void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait("${escaped.replace(/"/g, '`"')}");`
        await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
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
        try {
          await execFileAsync('cliclick', [`kp:${key}`])
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            const appleScriptKeyMapping: Record<string, string> = {
              enter: 'return',
              space: '" "',
              backspace: 'key code 51',
              tab: 'key code 48',
              escape: 'key code 53',
              up: 'key code 126',
              down: 'key code 125',
              left: 'key code 123',
              right: 'key code 124'
            }
            const keyLower = key.toLowerCase()
            const mapping = appleScriptKeyMapping[keyLower]
            let appleScript = ''
            if (mapping) {
              if (mapping.startsWith('key code')) {
                appleScript = `tell application "System Events" to ${mapping}`
              } else {
                appleScript = `tell application "System Events" to keystroke ${mapping}`
              }
            } else {
              appleScript = `tell application "System Events" to keystroke "${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
            }
            await execFileAsync('osascript', ['-e', appleScript])
          } else {
            throw err
          }
        }
      } else if (process.platform === 'linux') {
        await execFileAsync('xdotool', ['key', key])
      } else if (process.platform === 'win32') {
        const sendKeysMapping: Record<string, string> = {
          enter: '{ENTER}',
          space: ' ',
          backspace: '{BACKSPACE}',
          tab: '{TAB}',
          escape: '{ESC}',
          up: '{UP}',
          down: '{DOWN}',
          left: '{LEFT}',
          right: '{RIGHT}'
        }
        const keyLower = key.toLowerCase()
        const mappedKey = sendKeysMapping[keyLower] || (key.length > 1 ? `{${key.toUpperCase()}}` : key)
        const command = `[System.Void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait("${mappedKey.replace(/"/g, '`"')}");`
        await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
      } else {
        return { error: 'Unsupported platform' }
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
