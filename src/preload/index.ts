import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  platform: process.platform,
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // Dialog
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),
  saveFile: (defaultName: string, content: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, content),
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),

  // File System
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    readFiles: (paths: string[]) => ipcRenderer.invoke('fs:readFiles', paths),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    listDir: (path: string) => ipcRenderer.invoke('fs:listDir', path),
    stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
    mkdir: (path: string) => ipcRenderer.invoke('fs:mkdir', path),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    homeDir: () => ipcRenderer.invoke('fs:homeDir'),
    walk: (path: string) => ipcRenderer.invoke('fs:walk', path),
    copyDir: (src: string, dest: string) => ipcRenderer.invoke('fs:copyDir', src, dest),
    removeDir: (path: string) => ipcRenderer.invoke('fs:removeDir', path)
  },

  // Shell
  shell: {
    exec: (command: string, cwd?: string, timeoutMs?: number) =>
      ipcRenderer.invoke('shell:exec', command, cwd, timeoutMs),
    execFile: (file: string, args: string[], cwd?: string, timeoutMs?: number) =>
      ipcRenderer.invoke('shell:execFile', file, args, cwd, timeoutMs),
    killAll: () => ipcRenderer.invoke('shell:killAll')
  },

  // Main-process streaming flag: lets the window guard against closing while
  // an agent turn is in flight.
  setStreaming: (streaming: boolean) => ipcRenderer.send('app:streaming', streaming === true),

  workspace: {
    openIn: (path: string, app: string) => ipcRenderer.invoke('workspace:openIn', path, app),
    runScript: (cwd: string, script: string, packageManager?: string) => ipcRenderer.invoke('workspace:runScript', cwd, script, packageManager || 'npm'),
    openPath: (path: string) => ipcRenderer.invoke('app:openPath', path),
    getAppIcon: (path: string) => ipcRenderer.invoke('app:getFileIcon', path)
  },

  // Computer Use
  computer: {
    screenshot: () => ipcRenderer.invoke('computer:screenshot'),
    click: (x: number, y: number) => ipcRenderer.invoke('computer:click', x, y),
    type: (text: string) => ipcRenderer.invoke('computer:type', text),
    keypress: (key: string) => ipcRenderer.invoke('computer:keypress', key)
  },

  // Browser (embedded WebContentsView, driven by both the UI panel and the agent)
  browser: {
    open: (url: string) => ipcRenderer.invoke('browser:open', url),
    ensure: () => ipcRenderer.invoke('browser:ensure'),
    create: () => ipcRenderer.invoke('browser:create'),
    destroy: () => ipcRenderer.invoke('browser:destroy'),
    setVisible: (visible: boolean) => ipcRenderer.invoke('browser:setVisible', visible),
    state: () => ipcRenderer.invoke('browser:state'),
    logs: () => ipcRenderer.invoke('browser:logs'),
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    back: () => ipcRenderer.invoke('browser:back'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    eval: (code: string) => ipcRenderer.invoke('browser:eval', code),
    snapshot: (filter?: string) => ipcRenderer.invoke('browser:snapshot', filter || ''),
    click: (ref?: string, selector?: string) => ipcRenderer.invoke('browser:click', ref || '', selector || ''),
    fill: (ref: string | undefined, selector: string | undefined, value: string, submit?: boolean) =>
      ipcRenderer.invoke('browser:fill', ref || '', selector || '', value, submit === true),
    readText: (selector?: string) => ipcRenderer.invoke('browser:readText', selector || ''),
    screenshot: () => ipcRenderer.invoke('browser:screenshot'),
    devtools: () => ipcRenderer.invoke('browser:devtools'),
    setBounds: (x: number, y: number, w: number, h: number) => ipcRenderer.invoke('browser:bounds', x, y, w, h),
    getURL: () => ipcRenderer.invoke('browser:getURL'),
    onEvent: (callback: (data: Record<string, unknown>) => void) => {
      const handler = (_: unknown, data: Record<string, unknown>): void => callback(data)
      ipcRenderer.on('browser:event', handler)
      return () => ipcRenderer.removeListener('browser:event', handler)
    }
  },

  // Notifications
  notification: {
    send: (title: string, body: string) => ipcRenderer.invoke('notification:send', title, body)
  },

  // Permissions
  permission: {
    checkAccessibility: () => ipcRenderer.invoke('permission:checkAccessibility'),
    requestAccessibility: () => ipcRenderer.invoke('permission:requestAccessibility')
  },

  // Hidden-window handshake: the renderer signals that its routine listeners
  // are registered so the main process can deliver pending headless fires.
  headless: {
    ready: () => ipcRenderer.send('headless:ready')
  },

  // Config (TOML)
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config: unknown) => ipcRenderer.invoke('config:save', config),
    getPaths: () => ipcRenderer.invoke('config:getPaths')
  },

  // Database (SQLite)
  db: {
    loadAll: () => ipcRenderer.invoke('db:loadAll'),
    addProject: (id: string, name: string, path: string) => ipcRenderer.invoke('db:addProject', id, name, path),
    updateProjectName: (id: string, name: string) => ipcRenderer.invoke('db:updateProjectName', id, name),
    updateProjectPaths: (id: string, paths: string) => ipcRenderer.invoke('db:updateProjectPaths', id, paths),
    removeProject: (id: string) => ipcRenderer.invoke('db:removeProject', id),
    addSession: (id: string, projectId: string, title: string, path: string) => ipcRenderer.invoke('db:addSession', id, projectId, title, path),
    updateSessionTitle: (id: string, title: string) => ipcRenderer.invoke('db:updateSessionTitle', id, title),
    updateSessionPath: (id: string, path: string) => ipcRenderer.invoke('db:updateSessionPath', id, path),
    removeSession: (id: string) => ipcRenderer.invoke('db:removeSession', id),
    addMessage: (id: string, sessionId: string, role: string, content: string) => ipcRenderer.invoke('db:addMessage', id, sessionId, role, content),
    updateMessageContent: (id: string, content: string) => ipcRenderer.invoke('db:updateMessageContent', id, content),
    deleteMessage: (id: string) => ipcRenderer.invoke('db:deleteMessage', id),
    clearMessages: (sessionId: string) => ipcRenderer.invoke('db:clearMessages', sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke('db:getMessages', sessionId),
    getTranscript: (sessionId: string) => ipcRenderer.invoke('db:getTranscript', sessionId),
    saveTranscript: (sessionId: string, json: string) => ipcRenderer.invoke('db:saveTranscript', sessionId, json),
    clearTranscript: (sessionId: string) => ipcRenderer.invoke('db:clearTranscript', sessionId),
    addUsage: (row: unknown) => ipcRenderer.invoke('db:addUsage', row),
    getUsageBySession: (sessionId: string) => ipcRenderer.invoke('db:getUsageBySession', sessionId),
    getUsageSummary: (since: number) => ipcRenderer.invoke('db:getUsageSummary', since)
  },

  terminal: {
    create: (id: string, cols: number, rows: number, cwd?: string) => ipcRenderer.invoke('terminal:create', id, cols, rows, cwd),
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
    dispose: (id: string) => ipcRenderer.send('terminal:dispose', id),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_event: unknown, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => { ipcRenderer.removeListener('terminal:data', handler) }
    }
  },

  onAppShortcut: (callback: (name: string) => void) => {
    const handler = (_event: unknown, name: string) => callback(name)
    ipcRenderer.on('app:shortcut', handler)
    return () => { ipcRenderer.removeListener('app:shortcut', handler) }
  },

  routine: {
    list: () => ipcRenderer.invoke('routine:list'),
    add: (input: unknown) => ipcRenderer.invoke('routine:add', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('routine:update', id, patch),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('routine:setEnabled', id, enabled),
    remove: (id: string) => ipcRenderer.invoke('routine:remove', id),
    recordResult: (id: string, result: string) => ipcRenderer.invoke('routine:recordResult', id, result),
    onFire: (callback: (routine: unknown) => void) => {
      const handler = (_event: unknown, routine: unknown) => callback(routine)
      ipcRenderer.on('routine:fire', handler)
      return () => { ipcRenderer.removeListener('routine:fire', handler) }
    }
  },

  power: {
    setSleepPrevention: (mode: string) => ipcRenderer.invoke('power:setSleepPrevention', mode)
  },

  tray: {
    getEnabled: () => ipcRenderer.invoke('tray:getEnabled'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('tray:setEnabled', enabled),
    setLanguage: (lang: string) => ipcRenderer.invoke('tray:setLanguage', lang)
  },

  keybindings: {
    set: (id: string, combo: string) => ipcRenderer.invoke('keybindings:set', id, combo),
    setPaused: (paused: boolean) => ipcRenderer.invoke('keybindings:setPaused', paused)
  },

  mcp: {
    listTools: (projectPath?: string) => ipcRenderer.invoke('mcp:listTools', projectPath),
    status: (projectPath?: string) => ipcRenderer.invoke('mcp:status', projectPath),
    callTool: (projectPath: string | undefined, serverId: string, toolName: string, args: Record<string, unknown>) =>
      ipcRenderer.invoke('mcp:callTool', projectPath, serverId, toolName, args),
    addServer: (scope: 'user' | 'project', projectPath: string | undefined, id: string, input: Record<string, unknown>) =>
      ipcRenderer.invoke('mcp:addServer', scope, projectPath, id, input),
    removeServer: (scope: 'user' | 'project', projectPath: string | undefined, id: string) =>
      ipcRenderer.invoke('mcp:removeServer', scope, projectPath, id)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
