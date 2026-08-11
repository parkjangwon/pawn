import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  platform: process.platform,
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: (): Promise<{
    current: string
    latest?: string
    updateAvailable: boolean
    releaseUrl?: string
    releaseName?: string
    downloadUrl?: string
    downloadName?: string
    downloadSize?: number
    error?: string
  }> => ipcRenderer.invoke('app:checkForUpdates'),
  downloadUpdate: (): Promise<{
    ok?: boolean
    path?: string
    latest?: string
    current?: string
    opened?: boolean
    alreadyLatest?: boolean
    error?: string
  }> => ipcRenderer.invoke('app:downloadUpdate'),
  exportBackup: (opts?: {
    excludeSecrets?: boolean
  }): Promise<{
    ok?: boolean
    path?: string
    cancelled?: boolean
    error?: string
    excludeSecrets?: boolean
  }> => ipcRenderer.invoke('app:exportBackup', opts || {}),
  importBackup: (): Promise<{
    ok?: boolean
    path?: string
    cancelled?: boolean
    error?: string
    backupOfPrevious?: string
    needsRestart?: boolean
  }> => ipcRenderer.invoke('app:importBackup'),
  exportSession: (payload: {
    title?: string
    messages?: Array<{ role: string; content: string; modelLabel?: string }>
    includeTranscript?: boolean
    transcriptJson?: string
  }): Promise<{ ok?: boolean; path?: string; cancelled?: boolean; error?: string }> =>
    ipcRenderer.invoke('app:exportSession', payload),

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
    downloadsPath: () => ipcRenderer.invoke('fs:downloadsPath'),
    walk: (path: string) => ipcRenderer.invoke('fs:walk', path),
    copyDir: (src: string, dest: string) => ipcRenderer.invoke('fs:copyDir', src, dest),
    removeDir: (path: string) => ipcRenderer.invoke('fs:removeDir', path),
    readSpreadsheet: (path: string, opts?: { sheet?: string; maxRows?: number; maxCols?: number }) =>
      ipcRenderer.invoke('fs:readSpreadsheet', path, opts),
    contentSearch: (
      rootPath: string,
      opts: {
        query: string
        fixedString?: boolean
        caseInsensitive?: boolean
        glob?: string
        maxMatches?: number
        contextLines?: number
        timeoutMs?: number
      }
    ) => ipcRenderer.invoke('fs:contentSearch', rootPath, opts)
  },

  // Git worktree isolation for subagents
  worktree: {
    create: (projectPath: string, runId: string) =>
      ipcRenderer.invoke('worktree:create', projectPath, runId),
    remove: (projectPath: string, worktreePath: string, branch?: string) =>
      ipcRenderer.invoke('worktree:remove', projectPath, worktreePath, branch),
    diffStat: (worktreePath: string) => ipcRenderer.invoke('worktree:diffStat', worktreePath),
    diffPatch: (worktreePath: string) => ipcRenderer.invoke('worktree:diffPatch', worktreePath),
    changedFiles: (worktreePath: string) =>
      ipcRenderer.invoke('worktree:changedFiles', worktreePath),
    apply: (projectPath: string, worktreePath: string) =>
      ipcRenderer.invoke('worktree:apply', projectPath, worktreePath)
  },

  // Shell (sandbox opts: { enabled?, network?, projectRoot?, jailCwd? })
  shell: {
    exec: (
      command: string,
      cwd?: string,
      timeoutMs?: number,
      sandbox?: { enabled?: boolean; network?: boolean; projectRoot?: string }
    ) => ipcRenderer.invoke('shell:exec', command, cwd, timeoutMs, sandbox),
    execFile: (
      file: string,
      args: string[],
      cwd?: string,
      timeoutMs?: number,
      sandbox?: { enabled?: boolean; network?: boolean; projectRoot?: string }
    ) => ipcRenderer.invoke('shell:execFile', file, args, cwd, timeoutMs, sandbox),
    start: (
      command: string,
      cwd?: string,
      sandbox?: { enabled?: boolean; network?: boolean; projectRoot?: string }
    ) => ipcRenderer.invoke('shell:start', command, cwd, sandbox),
    poll: (jobId: string) => ipcRenderer.invoke('shell:poll', jobId),
    kill: (jobId: string) => ipcRenderer.invoke('shell:kill', jobId),
    killAll: () => ipcRenderer.invoke('shell:killAll'),
    killSession: (sessionId: string) => ipcRenderer.invoke('shell:killSession', sessionId)
  },

  // Main-process streaming flag: multi-session aware.
  // Prefer setSessionStreaming; setStreaming(boolean) remains for legacy/clear-all.
  setStreaming: (streaming: boolean) => ipcRenderer.send('app:streaming', streaming === true),
  setSessionStreaming: (sessionId: string, streaming: boolean) =>
    ipcRenderer.send('app:streaming', { sessionId, streaming: streaming === true }),
  clearStreaming: () => ipcRenderer.invoke('app:clearStreaming'),

  workspace: {
    openIn: (path: string, app: string) => ipcRenderer.invoke('workspace:openIn', path, app),
    reveal: (path: string) => ipcRenderer.invoke('workspace:reveal', path),
    runScript: (cwd: string, script: string, packageManager?: string) => ipcRenderer.invoke('workspace:runScript', cwd, script, packageManager || 'npm'),
    openPath: (path: string) => ipcRenderer.invoke('app:openPath', path),
    getAppIcon: (path: string) => ipcRenderer.invoke('app:getFileIcon', path)
  },

  // Computer Use (desktop automation)
  computer: {
    screenshot: (opts?: { displayId?: number; maxWidth?: number }) =>
      ipcRenderer.invoke('computer:screenshot', opts || {}),
    displays: () => ipcRenderer.invoke('computer:displays'),
    preflight: () => ipcRenderer.invoke('computer:preflight'),
    click: (
      x: number,
      y: number,
      opts?: {
        button?: string
        clicks?: number
        coordSpace?: string
        returnScreenshot?: boolean
        displayId?: number
      }
    ) => ipcRenderer.invoke('computer:click', x, y, opts || {}),
    move: (x: number, y: number, opts?: { coordSpace?: string }) =>
      ipcRenderer.invoke('computer:move', x, y, opts || {}),
    drag: (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      opts?: {
        button?: string
        steps?: number
        coordSpace?: string
        returnScreenshot?: boolean
        displayId?: number
      }
    ) => ipcRenderer.invoke('computer:drag', fromX, fromY, toX, toY, opts || {}),
    scroll: (
      x: number,
      y: number,
      opts?: {
        dy?: number
        dx?: number
        coordSpace?: string
        returnScreenshot?: boolean
        displayId?: number
      }
    ) => ipcRenderer.invoke('computer:scroll', x, y, opts || {}),
    type: (text: string, opts?: { returnScreenshot?: boolean }) =>
      ipcRenderer.invoke('computer:type', text, opts || {}),
    keypress: (key: string, opts?: { returnScreenshot?: boolean }) =>
      ipcRenderer.invoke('computer:keypress', key, opts || {}),
    clipboard: (action: string, text?: string) =>
      ipcRenderer.invoke('computer:clipboard', action, text),
    wait: (ms: number) => ipcRenderer.invoke('computer:wait', ms)
  },

  // Browser (embedded WebContentsView, driven by both the UI panel and the agent)
  browser: {
    open: (url: string) => ipcRenderer.invoke('browser:open', url),
    ensure: (owner?: string) => ipcRenderer.invoke('browser:ensure', owner),
    claim: (sessionId: string) => ipcRenderer.invoke('browser:claim', sessionId),
    release: (sessionId?: string) => ipcRenderer.invoke('browser:release', sessionId),
    releaseOwner: (owner: string) => ipcRenderer.invoke('browser:releaseOwner', owner),
    create: () => ipcRenderer.invoke('browser:create'),
    destroy: () => ipcRenderer.invoke('browser:destroy'),
    setVisible: (visible: boolean) => ipcRenderer.invoke('browser:setVisible', visible),
    hideCursor: () => ipcRenderer.invoke('browser:cursorHide'),
    pickStart: (placeholder?: string, hint?: string) =>
      ipcRenderer.invoke('browser:pickStart', placeholder || '', hint || ''),
    pickStop: () => ipcRenderer.invoke('browser:pickStop'),
    pickState: () => ipcRenderer.invoke('browser:pickState'),
    pickClear: () => ipcRenderer.invoke('browser:pickClear'),
    state: () => ipcRenderer.invoke('browser:state'),
    tabs: (owner?: string) => ipcRenderer.invoke('browser:tabs', owner),
    tabCreate: (url?: string, owner?: string) => ipcRenderer.invoke('browser:tabCreate', url || '', owner),
    tabSwitch: (id: string, owner?: string) => ipcRenderer.invoke('browser:tabSwitch', id, owner),
    tabClose: (id: string, owner?: string) => ipcRenderer.invoke('browser:tabClose', id, owner),
    logs: () => ipcRenderer.invoke('browser:logs'),
    navigate: (url: string, owner?: string) => ipcRenderer.invoke('browser:navigate', url, owner),
    back: (owner?: string) => ipcRenderer.invoke('browser:back', owner),
    reload: (owner?: string) => ipcRenderer.invoke('browser:reload', owner),
    eval: (code: string, owner?: string) => ipcRenderer.invoke('browser:eval', code, owner),
    snapshot: (filter?: string, owner?: string) => ipcRenderer.invoke('browser:snapshot', filter || '', owner),
    click: (ref?: string, selector?: string, owner?: string) =>
      ipcRenderer.invoke('browser:click', ref || '', selector || '', owner),
    fill: (ref: string | undefined, selector: string | undefined, value: string, submit?: boolean, owner?: string) =>
      ipcRenderer.invoke('browser:fill', ref || '', selector || '', value, submit === true, owner),
    readText: (selector?: string, owner?: string) => ipcRenderer.invoke('browser:readText', selector || '', owner),
    screenshot: (owner?: string) => ipcRenderer.invoke('browser:screenshot', owner),
    wait: (opts?: { ms?: number; selector?: string; text?: string; timeoutMs?: number }, owner?: string) =>
      ipcRenderer.invoke('browser:wait', opts || {}, owner),
    scroll: (opts?: { dy?: number; dx?: number; selector?: string }, owner?: string) =>
      ipcRenderer.invoke('browser:scroll', opts || {}, owner),
    select: (opts?: { ref?: string; selector?: string; value?: string }, owner?: string) =>
      ipcRenderer.invoke('browser:select', opts || {}, owner),
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
    addMessage: (
      id: string,
      sessionId: string,
      role: string,
      content: string,
      meta?: { thinking?: string; modelLabel?: string }
    ) => ipcRenderer.invoke('db:addMessage', id, sessionId, role, content, meta),
    updateMessageContent: (id: string, content: string) => ipcRenderer.invoke('db:updateMessageContent', id, content),
    updateMessageMeta: (
      id: string,
      meta: { thinking?: string; modelLabel?: string; content?: string }
    ) => ipcRenderer.invoke('db:updateMessageMeta', id, meta),
    deleteMessage: (id: string) => ipcRenderer.invoke('db:deleteMessage', id),
    clearMessages: (sessionId: string) => ipcRenderer.invoke('db:clearMessages', sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke('db:getMessages', sessionId),
    searchSessions: (query: string) => ipcRenderer.invoke('db:searchSessions', query),
    getTranscript: (sessionId: string) => ipcRenderer.invoke('db:getTranscript', sessionId),
    saveTranscript: (sessionId: string, json: string) => ipcRenderer.invoke('db:saveTranscript', sessionId, json),
    clearTranscript: (sessionId: string) => ipcRenderer.invoke('db:clearTranscript', sessionId),
    getSessionPlan: (sessionId: string) => ipcRenderer.invoke('db:getSessionPlan', sessionId),
    saveSessionPlan: (sessionId: string, json: string) =>
      ipcRenderer.invoke('db:saveSessionPlan', sessionId, json),
    getSessionAgentMode: (sessionId: string) => ipcRenderer.invoke('db:getSessionAgentMode', sessionId),
    saveSessionAgentMode: (sessionId: string, mode: string) =>
      ipcRenderer.invoke('db:saveSessionAgentMode', sessionId, mode),
    addUsage: (row: unknown) => ipcRenderer.invoke('db:addUsage', row),
    getUsageBySession: (sessionId: string) => ipcRenderer.invoke('db:getUsageBySession', sessionId),
    getUsageSummary: (since: number) => ipcRenderer.invoke('db:getUsageSummary', since),
    saveTurnCheckpoint: (sessionId: string, projectId: string, status: string, json: string) =>
      ipcRenderer.invoke('db:saveTurnCheckpoint', sessionId, projectId, status, json),
    clearTurnCheckpoint: (sessionId: string, status?: string) =>
      ipcRenderer.invoke('db:clearTurnCheckpoint', sessionId, status),
    listRunningTurnCheckpoints: () => ipcRenderer.invoke('db:listRunningTurnCheckpoints'),
    getTurnCheckpoint: (sessionId: string) => ipcRenderer.invoke('db:getTurnCheckpoint', sessionId),
    saveChangeLedgerTurn: (row: {
      id: string
      sessionId: string
      projectId: string
      createdAt: number
      label: string
      json: string
    }) => ipcRenderer.invoke('db:saveChangeLedgerTurn', row),
    listChangeLedgerTurns: (limit?: number) => ipcRenderer.invoke('db:listChangeLedgerTurns', limit),
    deleteChangeLedgerTurn: (id: string) => ipcRenderer.invoke('db:deleteChangeLedgerTurn', id),
    deleteChangeLedgerForSession: (sessionId: string) =>
      ipcRenderer.invoke('db:deleteChangeLedgerForSession', sessionId)
  },

  terminal: {
    create: (id: string, cols: number, rows: number, cwd?: string) => ipcRenderer.invoke('terminal:create', id, cols, rows, cwd),
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
    dispose: (id: string) => ipcRenderer.send('terminal:dispose', id),
    list: () => ipcRenderer.invoke('terminal:list'),
    readBuffer: (id: string, maxChars?: number) =>
      ipcRenderer.invoke('terminal:readBuffer', id, maxChars),
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

  window: {
    close: () => ipcRenderer.invoke('window:close')
  },

  prefs: {
    getConfirmQuit: () => ipcRenderer.invoke('prefs:getConfirmQuit') as Promise<boolean>,
    setConfirmQuit: (enabled: boolean) =>
      ipcRenderer.invoke('prefs:setConfirmQuit', enabled) as Promise<{ ok?: boolean; confirmQuit?: boolean }>
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
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    status: (provider: string) => ipcRenderer.invoke('connections:status', provider),
    connect: (provider: string) => ipcRenderer.invoke('connections:connect', provider),
    connectPat: (provider: string, credentials: Record<string, string>) =>
      ipcRenderer.invoke('connections:connectPat', provider, credentials),
    cancel: (provider: string) => ipcRenderer.invoke('connections:cancel', provider),
    disconnect: (provider: string) => ipcRenderer.invoke('connections:disconnect', provider),
    runTool: (name: string, args?: Record<string, unknown>) =>
      ipcRenderer.invoke('connections:runTool', name, args || {}),
    onProgress: (callback: (payload: {
      provider: string
      phase: string
      userCode?: string
      verificationUri?: string
      message?: string
    }) => void) => {
      const handler = (_event: unknown, payload: {
        provider: string
        phase: string
        userCode?: string
        verificationUri?: string
        message?: string
      }) => callback(payload)
      ipcRenderer.on('connections:progress', handler)
      return () => { ipcRenderer.removeListener('connections:progress', handler) }
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
  },

  /** Built-in public-web research (insane-search port) — not browser automation. */
  research: {
    fetch: (
      url: string,
      opts?: {
        timeoutMs?: number
        maxAttempts?: number | null
        enablePhase0?: boolean
        enableJina?: boolean
        deviceClass?: 'auto' | 'desktop' | 'mobile'
        maxContentChars?: number
        includeTrace?: boolean
      }
    ) => ipcRenderer.invoke('research:fetch', url, opts || {}),
    research: (input: {
      query?: string
      urls?: string[]
      maxSources?: number
      includeSearch?: boolean
      timeoutMs?: number
      maxAttempts?: number
    }) => ipcRenderer.invoke('research:research', input || {}),
    search: (input: {
      query?: string
      maxResults?: number
      timeoutMs?: number
      includeHn?: boolean
      includeWiki?: boolean
    }) => ipcRenderer.invoke('research:search', input || {})
  },

  /** Long-term local Memory (self-learning knowledge cards). */
  memory: {
    settings: () => ipcRenderer.invoke('memory:settings'),
    setSettings: (partial: Record<string, unknown>) => ipcRenderer.invoke('memory:setSettings', partial),
    save: (input: Record<string, unknown>) => ipcRenderer.invoke('memory:save', input),
    update: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('memory:update', id, patch),
    forget: (id: string) => ipcRenderer.invoke('memory:forget', id),
    forgetMany: (ids: string[]) => ipcRenderer.invoke('memory:forgetMany', ids),
    clear: (opts?: { projectId?: string | null; scope?: string }) =>
      ipcRenderer.invoke('memory:clear', opts || {}),
    search: (input: Record<string, unknown>) => ipcRenderer.invoke('memory:search', input),
    list: (input?: Record<string, unknown>) => ipcRenderer.invoke('memory:list', input || {}),
    get: (id: string) => ipcRenderer.invoke('memory:get', id),
    stats: () => ipcRenderer.invoke('memory:stats'),
    injectBlock: (opts: { query?: string; projectId?: string | null }) =>
      ipcRenderer.invoke('memory:injectBlock', opts || {}),
    ingestTurn: (input: {
      projectId?: string | null
      sessionId?: string
      messages?: Array<{ role: string; content: string }>
    }) => ipcRenderer.invoke('memory:ingestTurn', input || {}),
    export: () => ipcRenderer.invoke('memory:export'),
    consolidate: (opts?: { projectId?: string | null; threshold?: number; dryRun?: boolean }) =>
      ipcRenderer.invoke('memory:consolidate', opts || {}),
    import: (items: unknown[], projectId?: string | null) =>
      ipcRenderer.invoke('memory:import', items, projectId)
  },

  /** Agent lifecycle hooks (Claude/Codex-compatible). */
  hooks: {
    settings: () => ipcRenderer.invoke('hooks:settings'),
    setSettings: (partial: Record<string, unknown>) =>
      ipcRenderer.invoke('hooks:setSettings', partial),
    list: (projectPath?: string | null) => ipcRenderer.invoke('hooks:list', projectPath ?? null),
    run: (input: {
      event: string
      sessionId?: string
      projectPath?: string | null
      cwd?: string
      payload?: Record<string, unknown>
    }) => ipcRenderer.invoke('hooks:run', input || {})
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
