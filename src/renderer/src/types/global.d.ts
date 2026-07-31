export {}

declare global {
  interface Window {
    api: {
      platform: string
      selectFolder: () => Promise<string | null>
      fs: {
        readFile: (path: string) => Promise<string | { error: string }>
        writeFile: (path: string, content: string) => Promise<{ ok?: boolean; error?: string }>
        listDir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }> | { error: string }>
        stat: (path: string) => Promise<{ size: number; isFile: boolean; isDirectory: boolean; mtime: number } | { error: string }>
        mkdir: (path: string) => Promise<{ ok?: boolean; error?: string }>
        delete: (path: string) => Promise<{ ok?: boolean; error?: string }>
        exists: (path: string) => Promise<boolean>
        homeDir: () => Promise<string | null>
        walk: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }> | { error: string }>
      }
      shell: {
        exec: (command: string, cwd?: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
      }
      computer: {
        screenshot: () => Promise<{ dataUrl?: string; error?: string }>
        click: (x: number, y: number) => Promise<{ ok?: boolean; error?: string }>
        type: (text: string) => Promise<{ ok?: boolean; error?: string }>
        keypress: (key: string) => Promise<{ ok?: boolean; error?: string }>
      }
      browser: {
        open: (url: string) => Promise<{ ok?: boolean }>
        ensure: () => Promise<{ ok?: boolean; error?: string }>
        create: () => Promise<{ ok?: boolean; error?: string }>
        destroy: () => Promise<{ ok?: boolean; error?: string }>
        setVisible: (visible: boolean) => Promise<{ ok?: boolean }>
        state: () => Promise<{
          created: boolean; url?: string; title?: string; loading?: boolean
          canGoBack?: boolean; canGoForward?: boolean; visible?: boolean
        }>
        logs: () => Promise<string[]>
        navigate: (url: string) => Promise<{ url?: string; title?: string; error?: string }>
        back: () => Promise<{ url?: string; error?: string }>
        reload: () => Promise<{ ok?: boolean; error?: string }>
        eval: (code: string) => Promise<{ result?: string; error?: string }>
        snapshot: (filter?: string) => Promise<{
          url?: string; title?: string
          elements?: Array<{ ref: string; role: string; text: string; name: string; placeholder: string; value: string; href: string }>
          truncated?: boolean; error?: string
        }>
        click: (ref?: string, selector?: string) => Promise<{ message?: string; error?: string }>
        fill: (ref: string | undefined, selector: string | undefined, value: string, submit?: boolean) => Promise<{ message?: string; error?: string }>
        readText: (selector?: string) => Promise<{ text?: string; truncated?: boolean; error?: string }>
        screenshot: () => Promise<{ dataUrl?: string; bytes?: number; error?: string }>
        devtools: () => Promise<{ ok?: boolean; error?: string }>
        setBounds: (x: number, y: number, w: number, h: number) => Promise<{ ok?: boolean; error?: string }>
        getURL: () => Promise<{ url?: string; error?: string }>
        onEvent: (callback: (data: Record<string, unknown>) => void) => () => void
      }
      notification: {
        send: (title: string, body: string) => Promise<{ ok?: boolean }>
      }
      permission: {
        checkAccessibility: () => Promise<boolean>
        requestAccessibility: () => Promise<boolean>
      }
      schedule: {
        add: (id: string, intervalMs: number, payload: unknown) => Promise<{ ok?: boolean }>
        remove: (id: string) => Promise<{ ok?: boolean }>
        list: () => Promise<string[]>
        onTick: (callback: (data: { id: string; payload: unknown }) => void) => void
      }
      config: {
        load: () => Promise<Record<string, unknown>>
        save: (config: unknown) => Promise<{ ok?: boolean }>
      }
      db: {
        loadAll: () => Promise<{ projects: Array<{ id: string; name: string; path: string; sessions: Array<{ id: string; title: string; path: string; createdAt: number }> }> }>
        addProject: (id: string, name: string, path: string) => Promise<{ ok?: boolean }>
        updateProjectName: (id: string, name: string) => Promise<{ ok?: boolean }>
        updateProjectPaths: (id: string, paths: string) => Promise<{ ok?: boolean }>
        removeProject: (id: string) => Promise<{ ok?: boolean }>
        addSession: (id: string, projectId: string, title: string, path: string) => Promise<{ ok?: boolean }>
        updateSessionTitle: (id: string, title: string) => Promise<{ ok?: boolean }>
        updateSessionPath: (id: string, path: string) => Promise<{ ok?: boolean }>
        removeSession: (id: string) => Promise<{ ok?: boolean }>
        addMessage: (id: string, sessionId: string, role: string, content: string) => Promise<{ ok?: boolean }>
        updateMessageContent: (id: string, content: string) => Promise<{ ok?: boolean }>
        deleteMessage: (id: string) => Promise<{ ok?: boolean }>
        clearMessages: (sessionId: string) => Promise<{ ok?: boolean }>
        getMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; createdAt: number }>>
        getTranscript: (sessionId: string) => Promise<string | null>
        saveTranscript: (sessionId: string, json: string) => Promise<{ ok?: boolean }>
        clearTranscript: (sessionId: string) => Promise<{ ok?: boolean }>
        addUsage: (row: {
          id: string
          sessionId: string
          providerId: string
          modelId: string
          inputTokens: number
          outputTokens: number
          cacheReadTokens: number
          cacheWriteTokens: number
          cost: number
        }) => Promise<{ ok?: boolean }>
        getUsageBySession: (sessionId: string) => Promise<Array<Record<string, number | string>>>
        getUsageSummary: (since: number) => Promise<Array<{
          modelId: string
          providerId: string
          calls: number
          inputTokens: number
          outputTokens: number
          cacheReadTokens: number
          cacheWriteTokens: number
          cost: number
        }>>
      }
    }
  }
}
