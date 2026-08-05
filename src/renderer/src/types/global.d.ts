export {}

declare global {
  type RoutineSchedule =
    | { type: 'interval'; minutes: number }
    | { type: 'daily'; hour: number; minute: number }
    | { type: 'weekly'; weekday: number; hour: number; minute: number }

  interface Routine {
    id: string
    name: string
    schedule: string
    prompt: string
    projectId: string
    sessionId: string
    enabled: boolean
    nextRunAt: number
    lastRunAt: number
    lastResult: string
    createdAt: number
  }

  interface McpToolInfo {
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }

  type McpServerSource = 'user-claude' | 'user-pawn' | 'project'

  type McpServerStatus =
    | { id: string; source: McpServerSource; status: 'connecting' }
    | { id: string; source: McpServerSource; status: 'connected'; tools: McpToolInfo[] }
    | { id: string; source: McpServerSource; status: 'error'; error: string }

  interface McpServerInput {
    command: string
    args: string[]
    env?: Record<string, string>
  }
}

declare global {
  interface Window {
    __openRightPanelTab?: (id: string) => void
    __closeRightPanelTab?: (id: string) => void
    __toggleRightPanel?: () => void
    __toggleTerminal?: () => void
    __openTerminal?: () => void
    __closeTerminal?: () => void
    __openFileInPanel?: (path: string) => void
    api: {
      platform: string
      appVersion: () => Promise<string>
      selectFolder: () => Promise<string | null>
      saveFile: (defaultName: string, content: string) => Promise<string | null>
      openFile: () => Promise<string | null>
      fs: {
        readFile: (path: string) => Promise<string | { error: string }>
        readFiles: (paths: string[]) => Promise<Array<{ path: string; content?: string; error?: string }>>
        writeFile: (path: string, content: string) => Promise<{ ok?: boolean; error?: string }>
        listDir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }> | { error: string }>
        stat: (path: string) => Promise<{ size: number; isFile: boolean; isDirectory: boolean; mtime: number } | { error: string }>
        mkdir: (path: string) => Promise<{ ok?: boolean; error?: string }>
        delete: (path: string) => Promise<{ ok?: boolean; error?: string }>
        exists: (path: string) => Promise<boolean>
        homeDir: () => Promise<string | null>
        walk: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }> | { error: string }>
        copyDir: (src: string, dest: string) => Promise<{ ok?: boolean; error?: string }>
        removeDir: (path: string) => Promise<{ ok?: boolean; error?: string }>
        readSpreadsheet: (
          path: string,
          opts?: { sheet?: string; maxRows?: number; maxCols?: number }
        ) => Promise<{
          path?: string
          format?: string
          sheet?: string
          sheets?: string[]
          rows?: string[][]
          rowCount?: number
          colCount?: number
          truncated?: boolean
          previewMarkdown?: string
          error?: string
        }>
      }
      shell: {
        exec: (
          command: string,
          cwd?: string,
          timeoutMs?: number
        ) => Promise<{ stdout: string; stderr: string; exitCode: number; killed?: boolean }>
        execFile: (
          file: string,
          args: string[],
          cwd?: string,
          timeoutMs?: number
        ) => Promise<{ stdout: string; stderr: string; exitCode: number; killed?: boolean }>
        start: (
          command: string,
          cwd?: string
        ) => Promise<{ jobId?: string; pid?: number; error?: string }>
        poll: (jobId: string) => Promise<{
          jobId?: string
          command?: string
          status?: 'running' | 'exited'
          stdout?: string
          stderr?: string
          exitCode?: number | null
          killed?: boolean
          elapsedMs?: number
          error?: string
        }>
        kill: (jobId: string) => Promise<{ ok?: boolean; jobId?: string; error?: string }>
        killAll: () => Promise<{ ok?: boolean; killed?: number }>
      }
      setStreaming: (streaming: boolean) => void
      workspace: {
        openIn: (path: string, app: string) => Promise<{ ok?: boolean; error?: string }>
        runScript: (cwd: string, script: string, packageManager?: string) => Promise<{ ok?: boolean; error?: string }>
        openPath: (path: string) => Promise<{ ok?: boolean; error?: string }>
        getAppIcon: (path: string) => Promise<{ dataUrl?: string; error?: string }>
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
      headless: {
        ready: () => void
      }
      config: {
        load: () => Promise<Record<string, unknown>>
        save: (config: unknown) => Promise<{ ok?: boolean }>
        getPaths: () => Promise<{ configPath: string; dataDir: string }>
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
      terminal: {
        create: (id: string, cols: number, rows: number, cwd?: string) => Promise<{ ok?: boolean; error?: string }>
        write: (id: string, data: string) => void
        resize: (id: string, cols: number, rows: number) => void
        dispose: (id: string) => void
        list: () => Promise<{
          ok?: boolean
          error?: string
          terminals?: Array<{ id: string; bufferChars: number; alive: boolean }>
        }>
        readBuffer: (
          id: string,
          maxChars?: number
        ) => Promise<{
          ok?: boolean
          error?: string
          id?: string
          alive?: boolean
          text?: string
          rawChars?: number
          returnedChars?: number
        }>
        onData: (callback: (id: string, data: string) => void) => () => void
      }
      onAppShortcut: (callback: (name: string) => void) => () => void
      routine: {
        list: () => Promise<Routine[]>
        add: (input: { id: string; name: string; schedule: string; prompt: string; projectId?: string; sessionId?: string }) => Promise<{ ok?: boolean; error?: string; routine?: Routine }>
        update: (id: string, patch: Partial<Pick<Routine, 'name' | 'schedule' | 'prompt' | 'projectId' | 'sessionId'>>) => Promise<{ ok?: boolean }>
        setEnabled: (id: string, enabled: boolean) => Promise<{ ok?: boolean }>
        remove: (id: string) => Promise<{ ok?: boolean }>
        recordResult: (id: string, result: string) => Promise<{ ok?: boolean }>
        onFire: (callback: (routine: Routine) => void) => () => void
      }
      connections: {
        list: () => Promise<Array<{
          provider: 'google' | 'github'
          connected: boolean
          accountLabel?: string
          scope?: string
          clientConfigured: boolean
          updatedAt?: number
        }>>
        status: (provider: 'google' | 'github') => Promise<{
          provider: 'google' | 'github'
          connected: boolean
          accountLabel?: string
          scope?: string
          clientConfigured: boolean
          updatedAt?: number
        }>
        connect: (provider: 'google' | 'github') => Promise<{
          ok?: boolean
          error?: string
          accountLabel?: string
          userCode?: string
          verificationUri?: string
          cancelled?: boolean
        }>
        cancel: (provider: 'google' | 'github') => Promise<{ ok?: boolean; error?: string }>
        disconnect: (provider: 'google' | 'github') => Promise<{ ok?: boolean; error?: string }>
        runTool: (
          name: string,
          args?: Record<string, unknown>
        ) => Promise<{ ok?: boolean; text?: string; error?: string }>
        onProgress: (callback: (payload: {
          provider: 'google' | 'github'
          phase: string
          userCode?: string
          verificationUri?: string
          message?: string
        }) => void) => () => void
      }
      power: {
        setSleepPrevention: (mode: 'off' | 'sleep' | 'display') => Promise<{ ok?: boolean }>
      }
      tray: {
        getEnabled: () => Promise<boolean>
        setEnabled: (enabled: boolean) => Promise<{ ok?: boolean }>
        setLanguage: (lang: string) => Promise<{ ok?: boolean }>
      }
      keybindings: {
        set: (id: string, combo: string) => Promise<{ ok?: boolean }>
        setPaused: (paused: boolean) => Promise<{ ok?: boolean }>
      }
      mcp: {
        listTools: (projectPath?: string) => Promise<McpServerStatus[]>
        status: (projectPath?: string) => Promise<McpServerStatus[]>
        callTool: (
          projectPath: string | undefined,
          serverId: string,
          toolName: string,
          args: Record<string, unknown>
        ) => Promise<{ content: string; isError?: boolean }>
        addServer: (
          scope: 'user' | 'project',
          projectPath: string | undefined,
          id: string,
          input: McpServerInput
        ) => Promise<{ ok: boolean; error?: string }>
        removeServer: (
          scope: 'user' | 'project',
          projectPath: string | undefined,
          id: string
        ) => Promise<{ ok: boolean; error?: string }>
      }
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
        ) => Promise<{
          ok?: boolean
          text?: string
          error?: string
          finalUrl?: string
          verdict?: string
          mustInvokeBrowser?: boolean
          platform?: string
          title?: string
        }>
        research: (input: {
          query?: string
          urls?: string[]
          maxSources?: number
          includeSearch?: boolean
          timeoutMs?: number
          maxAttempts?: number
        }) => Promise<{
          ok?: boolean
          text?: string
          error?: string
          sourceCount?: number
          okCount?: number
          discoveredUrls?: string[]
        }>
        search: (input: {
          query?: string
          maxResults?: number
          timeoutMs?: number
          includeHn?: boolean
          includeWiki?: boolean
        }) => Promise<{
          ok?: boolean
          text?: string
          error?: string
          hitCount?: number
          hits?: Array<{ title: string; url: string; snippet?: string; source: string }>
        }>
      }
    }
  }
}
