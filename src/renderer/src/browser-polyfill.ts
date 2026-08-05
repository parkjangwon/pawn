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
    appVersion: async (): Promise<string> => 'web',
    selectFolder: async (): Promise<string | null> => {
      // Will be handled by FileBrowser component - return null to trigger it
      return null
    },
    saveFile: async (): Promise<string | null> => null,
    openFile: async (): Promise<string | null> => null,
    fs: {
      readFile: async (path: string) => {
        const result = await fsPost('readFile', { path })
        if (typeof result === 'string') return result
        return result as { error: string }
      },
      readFiles: async (paths: string[]) => {
        const results = await Promise.all(paths.map(async (path) => {
          const result = await fsPost('readFile', { path })
          if (typeof result === 'string') return { path, content: result }
          return { path, error: (result as { error: string }).error }
        }))
        return results
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
      },
      homeDir: async () => null,
      walk: async (path: string) => {
        return await fsPost('walk', { path }) as Array<{ name: string; path: string; isDirectory: boolean }> | { error: string }
      },
      copyDir: async () => ({ error: 'Not available in browser mode' }),
      removeDir: async () => ({ error: 'Not available in browser mode' }),
      readSpreadsheet: async () => ({ error: 'Not available in browser mode' })
    },
    shell: {
      exec: async (command: string, cwd?: string, timeoutMs?: number) => {
        // Shell exec not available via HTTP for security
        return { stdout: '', stderr: 'Shell exec not available in browser mode', exitCode: 1 }
      },
      execFile: async () => ({ stdout: '', stderr: 'Shell exec not available in browser mode', exitCode: 1 }),
      start: async () => ({ error: 'Shell not available in browser mode' }),
      poll: async () => ({ error: 'Shell not available in browser mode' }),
      kill: async () => ({ error: 'Shell not available in browser mode' }),
      killAll: async () => ({ ok: true, killed: 0 })
    },
    workspace: {
      openIn: async () => ({ error: 'Not available in browser mode' }),
      runScript: async () => ({ error: 'Not available in browser mode' }),
      openPath: async () => ({ error: 'Not available in browser mode' }),
      getAppIcon: async () => ({ error: 'Not available in browser mode' })
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
    headless: {
      ready: () => {}
    },
    setStreaming: () => {},
    tray: {
      getEnabled: async () => true,
      setEnabled: async () => ({ ok: true }),
      setLanguage: async () => ({ ok: true })
    },

    connections: {
      list: async () => [
        { provider: 'google' as const, connected: false, clientConfigured: true, authMode: 'oauth' as const },
        { provider: 'github' as const, connected: false, clientConfigured: true, authMode: 'oauth' as const },
        { provider: 'gitlab' as const, connected: false, clientConfigured: true, authMode: 'pat' as const },
        { provider: 'codecommit' as const, connected: false, clientConfigured: true, authMode: 'pat' as const }
      ],
      status: async (provider: 'google' | 'github' | 'gitlab' | 'codecommit') => ({
        provider,
        connected: false,
        clientConfigured: true,
        authMode: (provider === 'gitlab' || provider === 'codecommit' ? 'pat' : 'oauth') as 'oauth' | 'pat'
      }),
      connect: async () => ({ error: 'Connections require the desktop app' }),
      connectPat: async () => ({ error: 'Connections require the desktop app' }),
      cancel: async () => ({ ok: true }),
      disconnect: async () => ({ ok: true }),
      runTool: async () => ({ ok: false, error: 'Connections require the desktop app' }),
      onProgress: () => () => {}
    },

    // Config (TOML via HTTP)
    config: {
      load: async () => {
        const res = await fetch('/api/config/load', { method: 'POST' })
        return res.json()
      },
      save: async (config: unknown) => {
        await fetch('/api/config/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
        return { ok: true }
      },
      getPaths: async () => ({ configPath: '', dataDir: '' })
    },

    // Database (SQLite via HTTP)
    db: {
      loadAll: async () => { const res = await fetch('/api/db/loadAll', { method: 'POST' }); return res.json() },
      addProject: async (id: string, name: string, path: string) => { await fetch('/api/db/addProject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, path }) }); return { ok: true } },
      updateProjectName: async (id: string, name: string) => { await fetch('/api/db/updateProjectName', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) }); return { ok: true } },
      updateProjectPaths: async (id: string, paths: string) => { await fetch('/api/db/updateProjectPaths', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, paths }) }); return { ok: true } },
      removeProject: async (id: string) => { await fetch('/api/db/removeProject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { ok: true } },
      addSession: async (id: string, projectId: string, title: string, path: string) => { await fetch('/api/db/addSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, projectId, title, path }) }); return { ok: true } },
      updateSessionTitle: async (id: string, title: string) => { await fetch('/api/db/updateSessionTitle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, title }) }); return { ok: true } },
      updateSessionPath: async (id: string, path: string) => { await fetch('/api/db/updateSessionPath', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, path }) }); return { ok: true } },
      removeSession: async (id: string) => { await fetch('/api/db/removeSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { ok: true } },
      addMessage: async (id: string, sessionId: string, role: string, content: string) => { await fetch('/api/db/addMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, sessionId, role, content }) }); return { ok: true } },
      updateMessageContent: async (id: string, content: string) => { await fetch('/api/db/updateMessageContent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, content }) }); return { ok: true } },
      deleteMessage: async (id: string) => { await fetch('/api/db/deleteMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { ok: true } },
      getTranscript: async (sessionId: string) => { const res = await fetch('/api/db/getTranscript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }); const j = await res.json(); return typeof j === 'string' ? j : j?.json ?? null },
      saveTranscript: async (sessionId: string, json: string) => { await fetch('/api/db/saveTranscript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, json }) }); return { ok: true } },
      clearTranscript: async (sessionId: string) => { await fetch('/api/db/clearTranscript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }); return { ok: true } },
      addUsage: async (row: unknown) => { await fetch('/api/db/addUsage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) }); return { ok: true } },
      getUsageBySession: async (sessionId: string) => { const res = await fetch('/api/db/getUsageBySession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }); return res.json() },
      getUsageSummary: async (since: number) => { const res = await fetch('/api/db/getUsageSummary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since }) }); return res.json() },
      getMessages: async (sessionId: string) => { const res = await fetch('/api/db/getMessages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }); return res.json() },
      clearMessages: async (sessionId: string) => { await fetch('/api/db/clearMessages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }); return { ok: true } }
    }
  }
}

export {}
