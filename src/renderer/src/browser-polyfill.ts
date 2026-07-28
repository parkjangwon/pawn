// Browser-mode fallback for window.api when not running in Electron
// Uses HTTP endpoints provided by the Vite dev server to access the server's file system
if (typeof window !== 'undefined' && !window.api) {
  const fsPost = async (action: string, data: Record<string, unknown> = {}): Promise<unknown> => {
    const res = await fetch(`/api/fs/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return res.json()
  }

  (window as unknown as Record<string, unknown>).api = {
    platform: 'browser',
    selectFolder: async (): Promise<string | null> => {
      // Will be handled by FileBrowser component - return null to trigger it
      return null
    },
    fs: {
      readFile: async (path: string) => {
        const result = await fsPost('readFile', { path })
        if (typeof result === 'string') return result
        return result as { error: string }
      },
      writeFile: async (path: string, content: string) => {
        return await fsPost('writeFile', { path, content }) as { ok?: boolean; error?: string }
      },
      listDir: async (path: string) => {
        return await fsPost('listDir', { path }) as Array<{ name: string; isDirectory: boolean; path: string }> | { error: string }
      },
      stat: async (path: string) => {
        return await fsPost('stat', { path }) as { size: number; isFile: boolean; isDirectory: boolean; mtime: number } | { error: string }
      },
      mkdir: async (path: string) => {
        return await fsPost('mkdir', { path }) as { ok?: boolean; error?: string }
      },
      delete: async (path: string) => {
        return await fsPost('delete', { path }) as { ok?: boolean; error?: string }
      },
      exists: async (path: string) => {
        return await fsPost('exists', { path }) as boolean
      }
    },
    shell: {
      exec: async (command: string, cwd?: string) => {
        // Shell exec not available via HTTP for security
        return { stdout: '', stderr: 'Shell exec not available in browser mode', exitCode: 1 }
      }
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
