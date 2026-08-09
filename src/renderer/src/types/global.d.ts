export {}

declare global {
  type RoutineSchedule =
    | { type: 'interval'; minutes: number }
    | { type: 'daily'; hour: number; minute: number }
    | { type: 'weekly'; weekday: number; hour: number; minute: number }
    | { type: 'cron'; expr: string }
    | { type: 'file_watch'; path: string; debounceMinutes?: number }

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
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    type?: 'stdio' | 'http' | 'sse'
    headers?: Record<string, string>
  }
}

declare global {
  interface Window {
    __openRightPanelTab?: (id: string) => void
    __closeRightPanelTab?: (id: string) => void
    __toggleRightPanel?: () => void
    /** @deprecated use __openRightPanelTab('agents') */
    __openAgentsPanel?: () => void
    __toggleTerminal?: () => void
    __openTerminal?: () => void
    __closeTerminal?: () => void
    __openFileInPanel?: (path: string) => void
    api: {
      platform: string
      appVersion: () => Promise<string>
      checkForUpdates: () => Promise<{
        current: string
        latest?: string
        updateAvailable: boolean
        releaseUrl?: string
        releaseName?: string
        error?: string
      }>
      exportBackup: () => Promise<{
        ok?: boolean
        path?: string
        cancelled?: boolean
        error?: string
      }>
      importBackup: () => Promise<{
        ok?: boolean
        path?: string
        cancelled?: boolean
        error?: string
        backupOfPrevious?: string
        needsRestart?: boolean
      }>
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
        ) => Promise<{
          engine: 'rg' | 'git-grep' | 'none'
          matches: Array<{ path: string; line: number; text: string }>
          truncated: boolean
          error?: string
          text?: string
        }>
      }
      worktree?: {
        create: (
          projectPath: string,
          runId: string
        ) => Promise<{ ok: boolean; path?: string; branch?: string; error?: string }>
        remove: (
          projectPath: string,
          worktreePath: string,
          branch?: string
        ) => Promise<{ ok: boolean; error?: string }>
        diffStat: (worktreePath: string) => Promise<string>
        diffPatch?: (worktreePath: string) => Promise<string>
        changedFiles?: (worktreePath: string) => Promise<string[]>
        apply?: (
          projectPath: string,
          worktreePath: string
        ) => Promise<{
          ok: boolean
          files?: string[]
          conflicts?: string[]
          error?: string
          note?: string
        }>
      }
      shell: {
        exec: (
          command: string,
          cwd?: string,
          timeoutMs?: number,
          sandbox?: {
            enabled?: boolean
            network?: boolean
            projectRoot?: string
            jailCwd?: boolean
          }
        ) => Promise<{
          stdout: string
          stderr: string
          exitCode: number
          killed?: boolean
          sandboxNote?: string
        }>
        execFile: (
          file: string,
          args: string[],
          cwd?: string,
          timeoutMs?: number,
          sandbox?: {
            enabled?: boolean
            network?: boolean
            projectRoot?: string
            jailCwd?: boolean
          }
        ) => Promise<{ stdout: string; stderr: string; exitCode: number; killed?: boolean }>
        start: (
          command: string,
          cwd?: string,
          sandbox?: {
            enabled?: boolean
            network?: boolean
            projectRoot?: string
            jailCwd?: boolean
          }
        ) => Promise<{ jobId?: string; pid?: number; error?: string; sandboxNote?: string }>
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
        killSession: (sessionId: string) => Promise<{ ok?: boolean; killed?: number; error?: string }>
      }
      setStreaming: (streaming: boolean) => void
      setSessionStreaming?: (sessionId: string, streaming: boolean) => void
      clearStreaming?: () => Promise<{ ok?: boolean }>
      workspace: {
        openIn: (path: string, app: string) => Promise<{ ok?: boolean; error?: string }>
        reveal: (path: string) => Promise<{ ok?: boolean; error?: string }>
        runScript: (cwd: string, script: string, packageManager?: string) => Promise<{ ok?: boolean; error?: string }>
        openPath: (path: string) => Promise<{ ok?: boolean; error?: string }>
        getAppIcon: (path: string) => Promise<{ dataUrl?: string; error?: string }>
      }
      computer: {
        screenshot: (opts?: {
          displayId?: number
          maxWidth?: number
        }) => Promise<{
          dataUrl?: string
          error?: string
          width?: number
          height?: number
          screenWidth?: number
          screenHeight?: number
          scaleFactor?: number
          displayId?: number
          displayLabel?: string
          displays?: Array<{
            id: number
            label: string
            width: number
            height: number
            primary: boolean
          }>
        }>
        displays: () => Promise<{
          displays?: Array<{
            id: number
            label: string
            width: number
            height: number
            primary: boolean
          }>
          error?: string
        }>
        preflight: () => Promise<{
          ok: boolean
          platform: string
          notes: string[]
          errors: string[]
        }>
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
        ) => Promise<{
          ok?: boolean
          error?: string
          x?: number
          y?: number
          clamped?: boolean
          screenshot?: string
          screenshotMeta?: Record<string, number | undefined>
          screenshotError?: string
        }>
        move: (
          x: number,
          y: number,
          opts?: { coordSpace?: string }
        ) => Promise<{ ok?: boolean; error?: string; x?: number; y?: number }>
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
        ) => Promise<{
          ok?: boolean
          error?: string
          screenshot?: string
          screenshotError?: string
        }>
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
        ) => Promise<{
          ok?: boolean
          error?: string
          screenshot?: string
          screenshotError?: string
        }>
        type: (
          text: string,
          opts?: { returnScreenshot?: boolean }
        ) => Promise<{ ok?: boolean; error?: string; screenshot?: string }>
        keypress: (
          key: string,
          opts?: { returnScreenshot?: boolean }
        ) => Promise<{ ok?: boolean; error?: string; screenshot?: string }>
        clipboard: (
          action: string,
          text?: string
        ) => Promise<{ ok?: boolean; text?: string; error?: string }>
        wait: (ms: number) => Promise<{ ok?: boolean; ms?: number; error?: string }>
      }
      browser: {
        open: (url: string) => Promise<{ ok?: boolean }>
        ensure: () => Promise<{ ok?: boolean; error?: string }>
        create: () => Promise<{ ok?: boolean; error?: string }>
        destroy: () => Promise<{ ok?: boolean; error?: string }>
        setVisible: (visible: boolean) => Promise<{ ok?: boolean }>
        hideCursor: () => Promise<{ ok?: boolean }>
        pickStart: (placeholder?: string, hint?: string) => Promise<{ ok?: boolean; error?: string }>
        pickStop: () => Promise<{ ok?: boolean }>
        pickClear: () => Promise<{ ok?: boolean }>
        pickState: () => Promise<{
          active: boolean
          selection: null | {
            kind: 'element' | 'text'
            tag?: string
            id?: string
            classes?: string
            selector?: string
            ref?: string | null
            text?: string
            href?: string
            url?: string
            contextTag?: string
            contextText?: string
            box?: { x: number; y: number; w: number; h: number }
          }
          feedback: string
          ready: boolean
        }>
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
        wait: (opts?: {
          ms?: number
          selector?: string
          text?: string
          timeoutMs?: number
        }) => Promise<{ ok?: boolean; waitedMs?: number; error?: string }>
        scroll: (opts?: {
          dy?: number
          dx?: number
          selector?: string
        }) => Promise<{ ok?: boolean; error?: string }>
        select: (opts?: {
          ref?: string
          selector?: string
          value?: string
        }) => Promise<{ ok?: boolean; message?: string; error?: string }>
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
        addMessage: (
          id: string,
          sessionId: string,
          role: string,
          content: string,
          meta?: { thinking?: string; modelLabel?: string }
        ) => Promise<{ ok?: boolean }>
        updateMessageContent: (id: string, content: string) => Promise<{ ok?: boolean }>
        updateMessageMeta: (
          id: string,
          meta: { thinking?: string; modelLabel?: string; content?: string }
        ) => Promise<{ ok?: boolean }>
        deleteMessage: (id: string) => Promise<{ ok?: boolean }>
        clearMessages: (sessionId: string) => Promise<{ ok?: boolean }>
        getMessages: (sessionId: string) => Promise<
          Array<{
            id: string
            role: string
            content: string
            createdAt: number
            thinking?: string
            modelLabel?: string
          }>
        >
        getTranscript: (sessionId: string) => Promise<string | null>
        saveTranscript: (sessionId: string, json: string) => Promise<{ ok?: boolean }>
        clearTranscript: (sessionId: string) => Promise<{ ok?: boolean }>
        getSessionPlan: (sessionId: string) => Promise<string | null>
        saveSessionPlan: (sessionId: string, json: string) => Promise<{ ok?: boolean }>
        getSessionAgentMode: (sessionId: string) => Promise<string | null>
        saveSessionAgentMode: (sessionId: string, mode: string) => Promise<{ ok?: boolean }>
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
        saveTurnCheckpoint?: (
          sessionId: string,
          projectId: string,
          status: string,
          json: string
        ) => Promise<{ ok?: boolean }>
        clearTurnCheckpoint?: (sessionId: string, status?: string) => Promise<{ ok?: boolean }>
        listRunningTurnCheckpoints?: () => Promise<
          Array<{ sessionId: string; projectId: string; status: string; json: string; updatedAt: number }>
        >
        getTurnCheckpoint?: (
          sessionId: string
        ) => Promise<{
          sessionId: string
          projectId: string
          status: string
          json: string
          updatedAt: number
        } | null>
        saveChangeLedgerTurn?: (row: {
          id: string
          sessionId: string
          projectId: string
          createdAt: number
          label: string
          json: string
        }) => Promise<{ ok?: boolean }>
        listChangeLedgerTurns?: (limit?: number) => Promise<
          Array<{
            id: string
            sessionId: string
            projectId: string
            createdAt: number
            label: string
            json: string
          }>
        >
        deleteChangeLedgerTurn?: (id: string) => Promise<{ ok?: boolean }>
        deleteChangeLedgerForSession?: (sessionId: string) => Promise<{ ok?: boolean }>
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
          provider: 'google' | 'github' | 'gitlab' | 'codecommit'
          connected: boolean
          accountLabel?: string
          scope?: string
          clientConfigured: boolean
          authMode?: 'oauth' | 'pat'
          updatedAt?: number
          hostHint?: string
        }>>
        status: (provider: 'google' | 'github' | 'gitlab' | 'codecommit') => Promise<{
          provider: 'google' | 'github' | 'gitlab' | 'codecommit'
          connected: boolean
          accountLabel?: string
          scope?: string
          clientConfigured: boolean
          authMode?: 'oauth' | 'pat'
          updatedAt?: number
          hostHint?: string
        }>
        connect: (provider: 'google' | 'github' | 'gitlab' | 'codecommit') => Promise<{
          ok?: boolean
          error?: string
          accountLabel?: string
          userCode?: string
          verificationUri?: string
          cancelled?: boolean
        }>
        connectPat: (
          provider: 'gitlab' | 'codecommit',
          credentials: {
            token?: string
            baseUrl?: string
            region?: string
            accessKeyId?: string
            secretAccessKey?: string
            sessionToken?: string
          }
        ) => Promise<{ ok?: boolean; error?: string; accountLabel?: string }>
        cancel: (provider: 'google' | 'github' | 'gitlab' | 'codecommit') => Promise<{ ok?: boolean; error?: string }>
        disconnect: (provider: 'google' | 'github' | 'gitlab' | 'codecommit') => Promise<{ ok?: boolean; error?: string }>
        runTool: (
          name: string,
          args?: Record<string, unknown>
        ) => Promise<{ ok?: boolean; text?: string; error?: string }>
        onProgress: (callback: (payload: {
          provider: 'google' | 'github' | 'gitlab' | 'codecommit'
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
      window: {
        close: () => Promise<{ ok?: boolean }>
      }
      prefs: {
        getConfirmQuit: () => Promise<boolean>
        setConfirmQuit: (enabled: boolean) => Promise<{ ok?: boolean; confirmQuit?: boolean }>
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
      /** Agent lifecycle hooks (Claude/Codex-compatible). */
      hooks?: {
        settings: () => Promise<{
          enabled: boolean
          readClaude: boolean
          readPawn: boolean
        }>
        setSettings: (partial: {
          enabled?: boolean
          readClaude?: boolean
          readPawn?: boolean
        }) => Promise<{
          enabled: boolean
          readClaude: boolean
          readPawn: boolean
        }>
        list: (projectPath?: string | null) => Promise<{
          settings: { enabled: boolean; readClaude: boolean; readPawn: boolean }
          hooks: Array<{
            id: string
            event: string
            matcher: string
            type: string
            commandOrUrl: string
            source: string
          }>
          bySource: Record<string, number>
          byEvent: Record<string, number>
        }>
        run: (input: {
          event: string
          sessionId?: string
          projectPath?: string | null
          cwd?: string
          payload?: Record<string, unknown>
        }) => Promise<{
          ok: boolean
          decision: string
          reason?: string
          additionalContext: string[]
          ran: number
          errors: string[]
        }>
      }
      /** Long-term local Memory (self-learning knowledge cards). */
      memory?: {
        settings: () => Promise<{
          enabled: boolean
          autoCapture: boolean
          injectOnTurn: boolean
          injectLimit: number
          injectMaxChars: number
          requireMinConfidence: number
        }>
        setSettings: (partial: {
          enabled?: boolean
          autoCapture?: boolean
          injectOnTurn?: boolean
          injectLimit?: number
          injectMaxChars?: number
          requireMinConfidence?: number
        }) => Promise<{
          enabled: boolean
          autoCapture: boolean
          injectOnTurn: boolean
          injectLimit: number
          injectMaxChars: number
          requireMinConfidence: number
        }>
        save: (input: {
          content: string
          title?: string
          kind?: string
          scope?: string
          projectId?: string | null
          tags?: string[]
          source?: 'user' | 'agent' | 'auto' | 'import'
          confidence?: number
          pinned?: boolean
        }) => Promise<{
          ok: boolean
          memory?: MemoryRecordDto
          error?: string
          deduped?: boolean
        }>
        update: (
          id: string,
          patch: {
            content?: string
            title?: string
            kind?: string
            scope?: string
            projectId?: string | null
            tags?: string[]
            confidence?: number
            pinned?: boolean
            enabled?: boolean
          }
        ) => Promise<{ ok: boolean; memory?: MemoryRecordDto; error?: string }>
        forget: (id: string) => Promise<{ ok: boolean; error?: string }>
        forgetMany: (ids: string[]) => Promise<{ ok: boolean; deleted: number }>
        clear: (opts?: {
          projectId?: string | null
          scope?: string
        }) => Promise<{ ok: boolean; deleted: number }>
        search: (input: {
          query: string
          projectId?: string | null
          kind?: string
          scope?: string
          limit?: number
          includeDisabled?: boolean
        }) => Promise<
          Array<
            MemoryRecordDto & {
              score: number
              why: string
            }
          >
        >
        list: (input?: {
          projectId?: string | null
          kind?: string
          scope?: string
          limit?: number
          offset?: number
          query?: string
        }) => Promise<{ items: MemoryRecordDto[]; total: number }>
        get: (id: string) => Promise<MemoryRecordDto | null>
        stats: () => Promise<{
          total: number
          pinned: number
          byKind: Record<string, number>
          byScope: Record<string, number>
        }>
        consolidate: (opts?: {
          projectId?: string | null
          threshold?: number
          dryRun?: boolean
        }) => Promise<{
          ok: boolean
          merged: number
          examined: number
          pairs: Array<{ kept: string; dropped: string; score: number }>
        }>
        injectBlock: (opts?: {
          query?: string
          projectId?: string | null
        }) => Promise<string>
        ingestTurn: (input: {
          projectId?: string | null
          sessionId?: string
          messages?: Array<{ role: string; content: string }>
        }) => Promise<{
          ok: boolean
          saved: MemoryRecordDto[]
          skipped: number
          error?: string
        }>
        export: () => Promise<MemoryRecordDto[]>
        import: (
          items: unknown[],
          projectId?: string | null
        ) => Promise<{ ok: boolean; imported: number; skipped: number }>
      }
    }
  }

  interface MemoryRecordDto {
    id: string
    scope: string
    projectId: string | null
    kind: string
    title: string
    content: string
    tags: string[]
    source: string
    confidence: number
    pinned: boolean
    enabled: boolean
    hitCount: number
    createdAt: number
    updatedAt: number
    lastUsedAt: number | null
  }
}
