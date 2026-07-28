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
    }
  }
}
