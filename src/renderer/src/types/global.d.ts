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
        create: () => Promise<{ ok?: boolean; error?: string }>
        destroy: () => Promise<{ ok?: boolean; error?: string }>
        navigate: (url: string) => Promise<{ ok?: boolean; error?: string }>
        eval: (code: string) => Promise<{ result?: string; error?: string }>
        screenshot: () => Promise<{ dataUrl?: string; error?: string }>
        devtools: () => Promise<{ ok?: boolean; error?: string }>
        setBounds: (x: number, y: number, w: number, h: number) => Promise<{ ok?: boolean; error?: string }>
        reload: () => Promise<{ ok?: boolean; error?: string }>
        goBack: () => Promise<{ ok?: boolean; error?: string }>
        goForward: () => Promise<{ ok?: boolean; error?: string }>
        getURL: () => Promise<{ url?: string; error?: string }>
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
        clearMessages: (sessionId: string) => Promise<{ ok?: boolean }>
        getMessages: (sessionId: string) => Promise<Array<{ id: string; role: string; content: string; createdAt: number }>>
      }
    }
    /** Internal browser panel interface exposed by BrowserView.tsx for agent tool access */
    __pawnBrowser?: {
      navigate: (url: string) => void
      evaluate: (code: string) => Promise<unknown>
      getUrl: () => string | undefined
      getLogs: () => string[]
    }
  }
}
