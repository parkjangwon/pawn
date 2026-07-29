import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  platform: process.platform,

  // Dialog
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),

  // File System
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    listDir: (path: string) => ipcRenderer.invoke('fs:listDir', path),
    stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
    mkdir: (path: string) => ipcRenderer.invoke('fs:mkdir', path),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path)
  },

  // Shell
  shell: {
    exec: (command: string, cwd?: string) => ipcRenderer.invoke('shell:exec', command, cwd)
  },

  // Computer Use
  computer: {
    screenshot: () => ipcRenderer.invoke('computer:screenshot'),
    click: (x: number, y: number) => ipcRenderer.invoke('computer:click', x, y),
    type: (text: string) => ipcRenderer.invoke('computer:type', text),
    keypress: (key: string) => ipcRenderer.invoke('computer:keypress', key)
  },

  // Browser
  browser: {
    open: (url: string) => ipcRenderer.invoke('browser:open', url)
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

  // Scheduling
  schedule: {
    add: (id: string, intervalMs: number, payload: unknown) =>
      ipcRenderer.invoke('schedule:add', id, intervalMs, payload),
    remove: (id: string) => ipcRenderer.invoke('schedule:remove', id),
    list: () => ipcRenderer.invoke('schedule:list'),
    onTick: (callback: (data: { id: string; payload: unknown }) => void) => {
      ipcRenderer.on('schedule:tick', (_, data) => callback(data))
    }
  },

  // Config (TOML)
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config: unknown) => ipcRenderer.invoke('config:save', config)
  },

  // Database (SQLite)
  db: {
    loadAll: () => ipcRenderer.invoke('db:loadAll'),
    addProject: (id: string, name: string, path: string) => ipcRenderer.invoke('db:addProject', id, name, path),
    updateProjectName: (id: string, name: string) => ipcRenderer.invoke('db:updateProjectName', id, name),
    removeProject: (id: string) => ipcRenderer.invoke('db:removeProject', id),
    addSession: (id: string, projectId: string, title: string, path: string) => ipcRenderer.invoke('db:addSession', id, projectId, title, path),
    updateSessionTitle: (id: string, title: string) => ipcRenderer.invoke('db:updateSessionTitle', id, title),
    updateSessionPath: (id: string, path: string) => ipcRenderer.invoke('db:updateSessionPath', id, path),
    removeSession: (id: string) => ipcRenderer.invoke('db:removeSession', id),
    addMessage: (id: string, sessionId: string, role: string, content: string) => ipcRenderer.invoke('db:addMessage', id, sessionId, role, content),
    updateMessageContent: (id: string, content: string) => ipcRenderer.invoke('db:updateMessageContent', id, content)
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
