// Browser-mode fallback for window.api when not running in Electron
if (typeof window !== 'undefined' && !window.api) {
  (window as unknown as Record<string, unknown>).api = {
    platform: 'browser',
    selectFolder: async (): Promise<string | null> => {
      // Use native folder picker if available (Chrome/Edge)
      if ('showDirectoryPicker' in window) {
        try {
          const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<{ name: string }> }).showDirectoryPicker()
          return dirHandle.name || null
        } catch {
          return null // user cancelled
        }
      }
      // Fallback: text input
      const path = prompt('Enter project folder path:')
      return path?.trim() || null
    },
    fs: {
      readFile: async () => ({ error: 'Not available in browser mode' }),
      writeFile: async () => ({ error: 'Not available in browser mode' }),
      listDir: async () => ({ error: 'Not available in browser mode' }),
      stat: async () => ({ error: 'Not available in browser mode' }),
      mkdir: async () => ({ error: 'Not available in browser mode' }),
      delete: async () => ({ error: 'Not available in browser mode' }),
      exists: async () => false
    },
    shell: {
      exec: async () => ({ stdout: '', stderr: 'Not available in browser mode', exitCode: 1 })
    },
    computer: {
      screenshot: async () => ({ error: 'Not available in browser mode' }),
      click: async () => ({ error: 'Not available in browser mode' }),
      type: async () => ({ error: 'Not available in browser mode' }),
      keypress: async () => ({ error: 'Not available in browser mode' })
    },
    browser: {
      open: async (url: string) => { window.open(url, '_blank'); return { ok: true } }
    },
    notification: {
      send: async (title: string, body: string) => {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body })
        }
        return { ok: true }
      }
    },
    permission: {
      checkAccessibility: async () => true,
      requestAccessibility: async () => true
    },
    schedule: {
      add: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
      list: async () => [],
      onTick: () => {}
    }
  }
}

export {}
