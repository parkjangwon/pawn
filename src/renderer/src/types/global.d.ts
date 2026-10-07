export {}

declare global {
  type RoutineSchedule =
    | { type: 'interval'; minutes: number }
    | { type: 'daily'; hour: number; minute: number }
    | { type: 'weekly'; weekday: number; hour: number; minute: number }
    | { type: 'cron'; expr: string }
    | { type: 'file_watch'; path: string; debounceMinutes?: number }

  /** One skill from the public registry (skills.sh). */
  interface RegistrySkill {
    /** owner/repo/skill */
    id: string
    name: string
    /** owner/repo */
    source: string
    installs: number
  }

  interface SshHostDto {
    id: string
    label: string
    host: string
    user?: string
    port?: number
    identityFile?: string
    auth: 'key' | 'password'
    hasPassword: boolean
    createdAt: number
  }

  interface TelegramAllowDto {
    userId: string
    username?: string
    firstName?: string
    approvedAt: number
    language?: string
  }

  interface TelegramPendingDto {
    code: string
    userId: string
    username?: string
    firstName?: string
    chatId: string
    createdAt: number
    language?: string
  }

  interface TelegramStatusDto {
    ok: true
    enabled: boolean
    hasToken: boolean
    username?: string
    projectId: string
    allowFrom: TelegramAllowDto[]
    pending: TelegramPendingDto[]
    polling: boolean
    error?: string
  }

  type TelegramEventDto =
    | {
        type: 'inbound'
        chatId: string
        userId: string
        username?: string
        text: string
        projectId: string
        sessionId?: string
        language?: string
      }
    | {
        type: 'command'
        name: 'new' | 'stop' | 'sessions' | 'chat' | 'project' | 'usage' | 'plan' | 'build' | 'tasks' | 'changes' | 'undo' | 'model' | 'compact'
        chatId: string
        userId: string
        sessionId?: string
        projectId?: string
        arg?: string
        language?: string
      }
    | { type: 'permission'; requestId: string; approved: boolean }
    | { type: 'pairing'; code: string; userId: string; username?: string; chatId: string }
    | { type: 'status' }

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

  interface XaiStatusDto {
    signedIn: boolean
    email?: string
    expiresAt?: number
  }

  interface SubscriptionStatusDto {
    signedIn: boolean
    email?: string
    expiresAt?: number
  }

  interface SubscriptionLoginDto {
    ok: boolean
    email?: string
    error?: string
  }

  interface KiroStatusDto {
    signedIn: boolean
    mode?: 'builder-id' | 'idc' | 'api-key' | 'import'
    region?: string
    provider?: string
    importSource?: string
    expiresAt?: number
    profileArn?: string
    error?: string
  }

  interface KiroModelDto {
    modelId: string
    modelName?: string
    description?: string
    maxInputTokens?: number
    maxOutputTokens?: number
    supportsImages?: boolean
    rateMultiplier?: number
  }

  type KiroEventDto =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'toolUse'; id: string; name: string; input: Record<string, unknown>; parseError?: string }
    | { type: 'usage'; contextUsagePercentage?: number; inputTokens?: number; outputTokens?: number; credits?: number }
    | { type: 'error'; message: string; status?: number; transient: boolean; code?: string }
    | { type: 'done' }

  /** Record & Replay (mirrors src/main/recorder/types.ts). */
  type RecordingSourceDto = 'browser' | 'desktop'

  interface RecStepDto {
    index: number
    t: number
    source: RecordingSourceDto
    kind: string
    context: string
    text: string
  }

  interface RecordingStatusDto {
    state: 'idle' | 'recording'
    id?: string
    context?: { projectId?: string; sessionId?: string }
    goal?: string
    sources?: RecordingSourceDto[]
    startedAt?: number
    elapsedMs?: number
    steps?: number
    lastStep?: string
    notes?: string[]
  }

  interface RecordingBundleDto {
    id: string
    context: { projectId?: string; sessionId?: string }
    goal: string
    inputsHint: string
    startedAt: number
    durationMs: number
    sources: RecordingSourceDto[]
    steps: RecStepDto[]
    stepsText: string
    frames: Array<{ t: number; source: RecordingSourceDto; dataUrl: string; width: number; height: number; step: number }>
    stats: { events: number; steps: number; framesCaptured: number; truncated: boolean; stopReason: string }
    notes: string[]
  }

  type RecorderEventDto =
    | { type: 'started'; status: RecordingStatusDto }
    | { type: 'progress'; status: RecordingStatusDto }
    | { type: 'finished'; bundle: RecordingBundleDto }
    | { type: 'cancelled'; reason?: string }
    | { type: 'error'; error: string }
    | { type: 'open-setup' }

  interface RecorderReadinessDto {
    platform: string
    desktop: { supported: boolean; accessibility: boolean; screenRecording: boolean; error?: string }
  }

  /** Decision models (mirrors src/main/decision/types.ts). */
  type DecisionProviderKindDto = 'typesafe' | 'ollaya' | 'custom'

  interface DecisionFeaturesDto {
    agentTool: boolean
    shellRiskGuard: boolean
    routerAssist: boolean
  }

  interface DecisionProviderDto {
    id: string
    kind: DecisionProviderKindDto
    name: string
    baseUrl: string
    model: string
    enabled: boolean
    hasKey: boolean
    keyHint?: string
    local: boolean
  }

  interface DecisionStatusDto {
    providers: DecisionProviderDto[]
    features: DecisionFeaturesDto
    active: DecisionProviderDto | null
  }

  type DecisionAnswerDto =
    | { type: 'noul'; noul: number }
    | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
    | { type: 'score'; score: number; confidence: number; legend: Record<string, unknown>; probabilities: Record<string, number> }

  type DecisionResultDto =
    | {
        ok: true
        model: string
        answers: Record<string, DecisionAnswerDto>
        usage?: { input_tokens?: number; output_tokens?: number }
        latencyMs: number
        provider: { id: string; name: string; kind: DecisionProviderKindDto; local: boolean }
      }
    | { ok: false; error: string; code?: string; status?: number }

  interface LspWorkspaceEditDto {
    files: Array<{ path: string; edits: Array<{ startLine: number; startColumn: number; endLine: number; endColumn: number; newText: string }> }>
    creates: string[]
    renames: Array<{ from: string; to: string }>
    deletes: string[]
  }

  interface LspSymbolDto {
    name: string
    kind: string
    path: string
    line: number
    column: number
    endLine?: number
    detail?: string
    container?: string
    depth?: number
  }

  interface DebugResultDto {
    ok: boolean
    error?: string
    text?: string
    state?: { status: 'starting' | 'running' | 'stopped' | 'terminated'; reason?: string; location?: { path?: string; line: number } }
  }

  interface BrowserRuntimeEventDto {
    seq: number
    at: number
    kind: 'console' | 'exception' | 'network' | 'crash' | 'load'
    level: 'error' | 'warn' | 'info' | 'debug'
    text: string
    source?: string
    url?: string
    status?: number
    method?: string
  }

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
    __openRightPanelTab?: (id: string, opts?: { subagent?: boolean }) => void
    __closeRightPanelTab?: (id: string) => void
    __toggleRightPanel?: () => void
    /** Close the side panel outright (subagent browsing finished). */
    __closeRightPanel?: () => void
    /** Hide/show the embedded browser view while a full-screen overlay
     *  (Settings) is open — the native WebContentsView cannot be covered by
     *  renderer z-index. */
    __setRightPanelBrowserVisible?: (visible: boolean) => void
    /** Restore the embedded browser view after a full-screen overlay closes. */
    __restoreRightPanelBrowser?: () => void
    /** True while a full-screen overlay (Settings) covers the workspace —
     *  BrowserView checks this so the native view never shows through. */
    __fullscreenOverlayOpen?: boolean
    /** Set when subagent browsing opens the browser tab; cleared on user
     *  open/switch/close so the panel auto-closes only when a subagent
     *  actually drove it. */
    __subagentOpenedBrowserPanel?: boolean
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
        downloadUrl?: string
        downloadName?: string
        downloadSize?: number
        error?: string
      }>
      downloadUpdate: () => Promise<{
        ok?: boolean
        path?: string
        latest?: string
        current?: string
        opened?: boolean
        alreadyLatest?: boolean
        error?: string
      }>
      exportBackup: (opts?: {
        excludeSecrets?: boolean
      }) => Promise<{
        ok?: boolean
        path?: string
        cancelled?: boolean
        error?: string
        excludeSecrets?: boolean
      }>
      importBackup: () => Promise<{
        ok?: boolean
        path?: string
        cancelled?: boolean
        error?: string
        backupOfPrevious?: string
        needsRestart?: boolean
      }>
      exportSession: (payload: {
        title?: string
        messages?: Array<{ role: string; content: string; modelLabel?: string }>
        includeTranscript?: boolean
        transcriptJson?: string
      }) => Promise<{ ok?: boolean; path?: string; cancelled?: boolean; error?: string }>
      selectFolder: () => Promise<string | null>
      saveFile: (defaultName: string, content: string) => Promise<string | null>
      openFile: () => Promise<string | null>
      fs: {
        readFile: (path: string) => Promise<string | { error: string }>
        readFiles: (paths: string[]) => Promise<Array<{ path: string; content?: string; error?: string }>>
        writeFile: (path: string, content: string) => Promise<{ ok?: boolean; error?: string }>
        listDir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }> | { error: string }>
        stat: (path: string) => Promise<{ size: number; isFile: boolean; isDirectory: boolean; mtime: number } | { error: string }>
        readImage?: (path: string) => Promise<{ dataUrl: string; size: number; mtime: number } | { error: string; code?: string }>
        mkdir: (path: string) => Promise<{ ok?: boolean; error?: string }>
        delete: (path: string) => Promise<{ ok?: boolean; error?: string }>
        exists: (path: string) => Promise<boolean>
        homeDir: () => Promise<string | null>
        downloadsPath: () => Promise<string | null>
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
            hostId?: string
          }
        ) => Promise<{
          stdout: string
          stderr: string
          exitCode: number
          killed?: boolean
          sandboxNote?: string
          host?: string
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
            hostId?: string
            extraEnv?: Record<string, string>
          }
        ) => Promise<{ stdout: string; stderr: string; exitCode: number; killed?: boolean; host?: string }>
        start: (
          command: string,
          cwd?: string,
          sandbox?: {
            enabled?: boolean
            network?: boolean
            projectRoot?: string
            jailCwd?: boolean
            hostId?: string
            sessionId?: string
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
        /** Unified computer-use action (native helper on macOS, legacy elsewhere). */
        exec?: (
          action: string,
          args?: Record<string, unknown>,
          policy?: { maxLongEdge?: number; maxPixels?: number; format?: 'jpeg' | 'png'; quality?: number }
        ) => Promise<ComputerResultDto>
        status?: (opts?: { prompt?: boolean }) => Promise<{
          ok: boolean
          backend: 'native' | 'legacy'
          platform: string
          accessibility?: boolean
          screenRecording?: boolean
          helper?: string | null
          version?: string
          notes: string[]
          errors: string[]
        }>
        overlay?: (enabled: boolean, text?: string) => Promise<{ ok: boolean }>
        releaseAll?: () => Promise<{ ok: boolean }>
        onUserAbort?: (cb: (reason: string) => void) => () => void
      }
      browser: {
        open: (url: string) => Promise<{ ok?: boolean }>
        ensure: (owner?: string) => Promise<{ ok?: boolean; error?: string }>
        claim: (sessionId: string) => Promise<{ ok?: boolean; error?: string; ownerSessionId?: string }>
        release: (sessionId?: string) => Promise<{ ok?: boolean; error?: string }>
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
          created: boolean; activeTabId?: string | null
          tabs?: Array<{
            id: string; url: string; title: string
            loading: boolean; canGoBack: boolean; canGoForward: boolean
          }>
          url?: string; title?: string; loading?: boolean
          canGoBack?: boolean; canGoForward?: boolean; visible?: boolean
        }>
        tabs: (owner?: string) => Promise<{
          tabs: Array<{
            id: string; url: string; title: string
            loading: boolean; canGoBack: boolean; canGoForward: boolean
          }>
          activeTabId: string | null
          error?: string
        }>
        tabCreate: (url?: string, owner?: string) => Promise<{
          ok?: boolean
          activeTabId?: string | null
          tabId?: string
          tabs?: Array<{
            id: string; url: string; title: string
            loading: boolean; canGoBack: boolean; canGoForward: boolean
          }>
          error?: string
        }>
        tabSwitch: (id: string, owner?: string) => Promise<{ ok?: boolean; error?: string }>
        tabClose: (id: string, owner?: string) => Promise<{ ok?: boolean; error?: string }>
        releaseOwner: (owner: string) => Promise<{ ok?: boolean; error?: string }>
        logs: () => Promise<string[]>
        runtime?: (
          owner?: string,
          opts?: { since?: number; kinds?: string[]; minLevel?: string; limit?: number; clear?: boolean }
        ) => Promise<{ ok: boolean; error?: string; events: BrowserRuntimeEventDto[]; latestSeq: number; text?: string; url?: string }>
        navigate: (url: string, owner?: string) => Promise<{ url?: string; title?: string; error?: string }>
        back: (owner?: string) => Promise<{ url?: string; error?: string }>
        reload: (owner?: string) => Promise<{ ok?: boolean; error?: string }>
        eval: (code: string, owner?: string) => Promise<{ result?: string; error?: string }>
        snapshot: (filter?: string, owner?: string) => Promise<{
          url?: string; title?: string
          elements?: Array<{ ref: string; role: string; text: string; name: string; placeholder: string; value: string; href: string }>
          truncated?: boolean; error?: string
        }>
        click: (ref?: string, selector?: string, owner?: string) => Promise<{ message?: string; error?: string }>
        fill: (ref: string | undefined, selector: string | undefined, value: string, submit?: boolean, owner?: string) => Promise<{ message?: string; error?: string }>
        readText: (selector?: string, owner?: string) => Promise<{ text?: string; truncated?: boolean; error?: string }>
        screenshot: (owner?: string) => Promise<{ dataUrl?: string; bytes?: number; error?: string }>
        wait: (opts?: {
          ms?: number
          selector?: string
          text?: string
          timeoutMs?: number
        }, owner?: string) => Promise<{ ok?: boolean; waitedMs?: number; error?: string }>
        scroll: (opts?: {
          dy?: number
          dx?: number
          selector?: string
        }, owner?: string) => Promise<{ ok?: boolean; error?: string }>
        select: (opts?: {
          ref?: string
          selector?: string
          value?: string
        }, owner?: string) => Promise<{ ok?: boolean; message?: string; error?: string }>
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
        updateProjectExecutionTarget: (id: string, executionHost: string, remotePath: string) => Promise<{ ok?: boolean; error?: string }>
        removeProject: (id: string) => Promise<{ ok?: boolean }>
        addSession: (id: string, projectId: string, title: string, path: string) => Promise<{ ok?: boolean }>
        updateSessionTitle: (id: string, title: string) => Promise<{ ok?: boolean }>
        updateSessionPath: (id: string, path: string) => Promise<{ ok?: boolean }>
        removeSession: (id: string) => Promise<{ ok?: boolean }>
        setSessionArchived: (id: string, archivedAt: number | null) => Promise<{ ok?: boolean }>
        listArchivedSessions: () => Promise<{ ok?: boolean; sessions?: Array<{ id: string; projectId: string; projectName: string; title: string; createdAt: number; archivedAt: number }> }>
        addMessage: (
          id: string,
          sessionId: string,
          role: string,
          content: string,
          meta?: { thinking?: string; modelLabel?: string; toolMeta?: string }
        ) => Promise<{ ok?: boolean }>
        updateMessageContent: (id: string, content: string) => Promise<{ ok?: boolean }>
        updateMessageMeta: (
          id: string,
          meta: { thinking?: string; modelLabel?: string; content?: string; durationMs?: number }
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
            durationMs?: number
            toolMeta?: string
          }>
        >
        searchSessions: (query: string) => Promise<
          Array<{
            id: string
            projectId: string
            title: string
            createdAt: number
            snippet: string
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
        listTools: (projectPath?: string, serverId?: string) => Promise<McpServerStatus[]>
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
      skills?: {
        search: (query: string) => Promise<{ skills: RegistrySkill[]; error?: string }>
        details: (id: string) => Promise<{ description: string; firstSeen?: string } | { error: string }>
        install: (id: string) => Promise<{ ok: true; name: string; path: string } | { ok: false; error: string }>
        remove: (name: string) => Promise<{ ok: boolean; error?: string }>
        installed: () => Promise<string[]>
      }
      /** Record & Replay (macOS). */
      recorder?: {
        status: () => Promise<RecordingStatusDto>
        readiness: () => Promise<RecorderReadinessDto>
        start: (req: {
          goal?: string
          inputsHint?: string
          sources?: RecordingSourceDto[]
          context?: { projectId?: string; sessionId?: string }
        }) => Promise<{ ok: true; status: RecordingStatusDto } | { ok: false; error: string }>
        stop: () => Promise<{ ok: boolean; error?: string; steps?: number }>
        cancel: () => Promise<{ ok: boolean }>
        openPermissions: (which: 'accessibility' | 'screen') => Promise<{ ok: boolean }>
        onEvent: (callback: (event: RecorderEventDto) => void) => () => void
      }
      /** Skills Pawn writes to ~/.agents/skills. */
      localSkills?: {
        save: (
          name: string,
          content: string,
          opts?: { overwrite?: boolean }
        ) => Promise<{ ok: true; path: string; created: boolean } | { ok: false; error: string; exists?: boolean }>
        read: (name: string) => Promise<{ ok: true; path: string; content: string } | { ok: false; error: string }>
      }
      /** Decision models (TypeSafe Jev, Ollaya, …). Keys never reach the renderer. */
      decision?: {
        status: () => Promise<DecisionStatusDto>
        saveProvider: (input: {
          id?: string
          kind?: DecisionProviderKindDto
          name?: string
          baseUrl?: string
          /** undefined keeps the stored key, '' clears it. */
          apiKey?: string
          model?: string
        }) => Promise<{ ok: true; id: string; status: DecisionStatusDto } | { ok: false; error: string }>
        removeProvider: (id: string) => Promise<{ ok: boolean; error?: string; status?: DecisionStatusDto }>
        setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string; status?: DecisionStatusDto }>
        setFeatures: (partial: Partial<DecisionFeaturesDto>) => Promise<{ ok: boolean; status: DecisionStatusDto }>
        models: (id: string) => Promise<
          | { ok: true; models: Array<{ name: string; description?: string; releaseDate?: string }> }
          | { ok: false; error: string; code?: string }
        >
        test: (id: string) => Promise<DecisionResultDto>
        decide: (
          input: { state: unknown; questions: Record<string, unknown>; model?: string },
          opts?: { purpose?: 'tool' | 'shell_risk' | 'routing'; timeoutMs?: number; maxRetries?: number }
        ) => Promise<DecisionResultDto>
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
      /** Claude Code–compatible mods (in-process JS/TS hooks modules). */
      mods?: {
        settings: () => Promise<{
          enabled: boolean
          disableAllHooks: boolean
          disabledPlugins: string[]
          consentedPlugins: Array<{ name: string; version: string }> | null
          pluginDirs: string[]
          readClaudePlugins: boolean
          pluginOrder: string[]
        }>
        setSettings: (partial: {
          enabled?: boolean
          disableAllHooks?: boolean
          disabledPlugins?: string[]
          consentedPlugins?: Array<{ name: string; version: string }> | null
          pluginDirs?: string[]
          readClaudePlugins?: boolean
          pluginOrder?: string[]
        }) => Promise<{
          enabled: boolean
          disableAllHooks: boolean
          disabledPlugins: string[]
          consentedPlugins: Array<{ name: string; version: string }> | null
          pluginDirs: string[]
          readClaudePlugins: boolean
          pluginOrder: string[]
        }>
        list: (projectPath?: string | null) => Promise<{
          ok: boolean
          mods: Array<{
            id: string
            name: string
            version: string
            description: string
            root: string
            source: string
            enabled: boolean
            consented: boolean
            consentStale: boolean
            tier: string
          }>
        }>
        loadSources: (projectPath?: string | null) => Promise<{
          ok: boolean
          settings?: {
            enabled: boolean
            disableAllHooks: boolean
            disabledPlugins: string[]
            consentedPlugins: Array<{ name: string; version: string }> | null
            pluginDirs: string[]
            readClaudePlugins: boolean
            pluginOrder: string[]
          }
          mods?: Array<{
            id: string
            name: string
            version: string
            description: string
            root: string
            source: string
            enabled: boolean
            consented: boolean
            consentStale: boolean
            tier: string
            moduleRelative: string
            userConfig: Record<string, unknown>
          }>
          sources?: Array<{
            id: string
            name: string
            root: string
            tier: string
            sources: string[]
            language: string
            userConfig: Record<string, unknown>
          }>
        }>
        validate: (path: string) => Promise<{
          ok: boolean
          report: {
            ok: boolean
            hooks: string[]
            calls: string[]
            envReads: string[]
            envWrites: string[]
            findings: Array<{ severity: string; message: string; file?: string }>
          }
          text: string
        }>
        installExample: () => Promise<{
          ok: boolean
          path?: string
          error?: string
          existed?: boolean
        }>
        envSnapshot: () => Promise<{ ok: boolean; values: Record<string, string> }>
        http: (
          url: string,
          init?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
        ) => Promise<{
          status: number
          ok: boolean
          headers: Record<string, string>
          text: string
          error?: string
        }>
      }
      /** Language servers (tsserver, pyright, gopls, rust-analyzer) run in main. */
      lsp?: {
        setEnabled: (enabled: boolean) => Promise<{ ok: boolean }>
        status: (root: string) => Promise<LspServerStatusDto[]>
        diagnostics: (
          root: string,
          paths: string[],
          opts?: { waitMs?: number; content?: Record<string, string> }
        ) => Promise<{
          ok: boolean
          error?: string
          files: Array<{ path: string; diagnostics: LspDiagnosticDto[] }>
          unsupported?: string[]
        }>
        definition: (
          root: string,
          path: string,
          line: number,
          character: number
        ) => Promise<{ ok: boolean; error?: string; locations: LspLocationDto[] }>
        references: (
          root: string,
          path: string,
          line: number,
          character: number
        ) => Promise<{ ok: boolean; error?: string; locations: LspLocationDto[] }>
        hover: (
          root: string,
          path: string,
          line: number,
          character: number
        ) => Promise<{ ok: boolean; error?: string; text?: string }>
        rename?: (
          root: string,
          path: string,
          line: number,
          character: number,
          newName: string
        ) => Promise<{ ok: boolean; error?: string; edit?: LspWorkspaceEditDto }>
        symbols?: (root: string, path: string, query?: string) => Promise<{ ok: boolean; error?: string; symbols?: LspSymbolDto[] }>
        callHierarchy?: (
          root: string,
          path: string,
          line: number,
          character: number,
          direction: 'incoming' | 'outgoing'
        ) => Promise<{ ok: boolean; error?: string; item?: LspSymbolDto; calls?: Array<LspSymbolDto & { callLines: number[] }> }>
        codeActions?: (
          root: string,
          path: string,
          range: { startLine: number; startColumn?: number; endLine?: number; endColumn?: number },
          only?: string[]
        ) => Promise<{
          ok: boolean
          error?: string
          actions?: Array<{ index: number; title: string; kind?: string; isPreferred?: boolean; hasEdit: boolean; hasCommand: boolean; disabled?: string }>
        }>
        applyCodeAction?: (
          root: string,
          path: string,
          index: number
        ) => Promise<{ ok: boolean; error?: string; title?: string; edit?: LspWorkspaceEditDto }>
      }
      kiro?: {
        status: () => Promise<KiroStatusDto>
        startLogin: (opts: { mode: 'builder-id' | 'idc'; startUrl?: string; region?: string }) => Promise<
          { ok: true; verificationUri: string; verificationUriComplete: string; userCode: string; expiresIn: number } | { ok: false; error: string; code?: string }
        >
        cancelLogin: () => Promise<{ ok: boolean }>
        signOut: () => Promise<{ ok: boolean }>
        setApiKey: (key: string, region?: string) => Promise<{ ok: boolean; error?: string; status?: KiroStatusDto }>
        importLogin: (source?: 'auto' | 'kiro-cli' | 'kiro-ide') => Promise<{ ok: boolean; error?: string; status?: KiroStatusDto }>
        models: () => Promise<{ ok: boolean; error?: string; models?: KiroModelDto[] }>
        usage: () => Promise<{ ok: boolean; error?: string; usage?: { used?: number; limit?: number; resetAt?: string } | null }>
        chatStart: (requestId: string, body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
        chatAbort: (requestId: string) => Promise<{ ok: boolean }>
        onEvent: (callback: (data: { requestId: string; event: KiroEventDto }) => void) => () => void
        onLoginDone: (callback: (data: { ok: boolean; status?: KiroStatusDto; error?: string }) => void) => () => void
      }
      /** xAI subscription sign-in (device code). API keys stay on the provider row. */
      xai?: {
        status: () => Promise<XaiStatusDto>
        startLogin: () => Promise<
          | { ok: true; userCode: string; verificationUri: string; verificationUriComplete: string; expiresIn: number }
          | { ok: false; error: string }
        >
        cancelLogin: () => Promise<{ ok: boolean }>
        signOut: () => Promise<{ ok: boolean }>
        accessToken: () => Promise<{ ok: true; token: string } | { ok: false; error?: string }>
        onLoginDone: (callback: (data: { ok: boolean; email?: string; error?: string }) => void) => () => void
      }
      /** ChatGPT subscription (Codex device code). The refresh token stays in the main process. */
      chatgpt?: {
        status: () => Promise<SubscriptionStatusDto>
        startLogin: () => Promise<
          | { ok: true; userCode: string; verificationUri: string; verificationUriComplete: string; expiresIn: number }
          | { ok: false; error: string }
        >
        cancelLogin: () => Promise<{ ok: boolean }>
        signOut: () => Promise<{ ok: boolean }>
        accessToken: () => Promise<{ ok: true; token: string; accountId?: string } | { ok: false; error?: string }>
        onLoginDone: (callback: (data: SubscriptionLoginDto) => void) => () => void
      }
      /** Claude subscription (paste the code from the consent page). */
      claudeOauth?: {
        status: () => Promise<SubscriptionStatusDto>
        startLogin: () => Promise<{ ok: true; verificationUri: string; verificationUriComplete: string } | { ok: false; error: string }>
        submitCode: (code: string) => Promise<{ ok: boolean; error?: string; email?: string }>
        cancelLogin: () => Promise<{ ok: boolean }>
        signOut: () => Promise<{ ok: boolean }>
        accessToken: () => Promise<{ ok: true; token: string } | { ok: false; error?: string }>
        onLoginDone: (callback: (data: SubscriptionLoginDto) => void) => () => void
      }
      /** Antigravity subscription (Google loopback on port 51121). */
      antigravity?: {
        status: () => Promise<SubscriptionStatusDto>
        startLogin: () => Promise<{ ok: true; verificationUri: string; verificationUriComplete: string } | { ok: false; error: string }>
        cancelLogin: () => Promise<{ ok: boolean }>
        signOut: () => Promise<{ ok: boolean }>
        accessToken: () => Promise<{ ok: true; token: string; projectId?: string } | { ok: false; error?: string }>
        onLoginDone: (callback: (data: SubscriptionLoginDto) => void) => () => void
      }
      bash?: {
        run: (
          key: string,
          command: string,
          opts: { cwd: string; timeoutMs?: number; sandbox?: Record<string, unknown> }
        ) => Promise<{ ok: boolean; error?: string; text?: string; exitCode?: number | null; cwd?: string; timedOut?: boolean; restarted?: boolean }>
        restart: (key: string, cwd: string, sandbox?: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; text?: string }>
        kill: (key: string) => Promise<{ ok: boolean }>
      }
      debug?: {
        start: (opts: Record<string, unknown>) => Promise<DebugResultDto>
        setBreakpoints: (key: string, path: string, lines: Array<number | { line: number; condition?: string }>) => Promise<DebugResultDto>
        control: (key: string, action: 'continue' | 'over' | 'into' | 'out' | 'pause' | 'state', timeoutMs?: number) => Promise<DebugResultDto>
        evaluate: (key: string, expression: string, frameId?: number) => Promise<{ ok: boolean; error?: string; result?: string; type?: string }>
        stop: (key: string) => Promise<{ ok: boolean; error?: string }>
        list: () => Promise<Array<{ sessionKey: string; language: string; status: string }>>
      }
      codeIndex?: {
        search: (
          root: string,
          queries: string[],
          opts?: { limit?: number; pathPrefix?: string }
        ) => Promise<{ ok: boolean; error?: string; text?: string; chunks?: number; hits?: Array<{ path: string; startLine: number; endLine: number; symbol?: string; score: number }> }>
        update: (root: string) => Promise<{ ok: boolean; error?: string; files?: number; chunks?: number; ms?: number }>
      }
      tests?: {
        affected: (
          root: string,
          files: string[],
          opts?: { maxDepth?: number; limit?: number }
        ) => Promise<{ ok: boolean; error?: string; text?: string; tests?: string[]; commands?: Array<{ runner: string; command: string }> }>
      }
      net?: {
        probePort: (port: number, host?: string) => Promise<{ ok: boolean; open: boolean }>
      }
      outputs?: {
        save: (sessionId: string, content: string) => Promise<{ ok: boolean; error?: string; id?: string; chars?: number; lines?: number }>
        read: (id: string, opts?: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; text?: string }>
      }
      /** UI paging over offloaded tool outputs (chat tool rows). */
      toolOutput?: {
        get: (
          id: string,
          offset?: number,
          limit?: number
        ) => Promise<{ ok: boolean; error?: string; content?: string; total?: number; hasMore?: boolean }>
      }
      profile?: {
        get: (root: string) => Promise<{ ok: boolean; error?: string; json: string | null }>
        save: (root: string, json: string) => Promise<{ ok: boolean; error?: string }>
      }
      /** SSH remote-execution hosts. Secrets stay in the main process. */
      ssh?: {
        list: () => Promise<{
          ok: boolean
          hosts: Array<{
            id: string
            label: string
            host: string
            user?: string
            port?: number
            identityFile?: string
            auth: 'key' | 'password'
            hasPassword: boolean
            createdAt: number
          }>
          sshpassAvailable: boolean
        }>
        add: (input: {
          label?: string
          host: string
          user?: string
          port?: number
          identityFile?: string
          auth?: 'key' | 'password'
          password?: string
        }) => Promise<{ ok: boolean; host?: SshHostDto; error?: string }>
        remove: (hostId: string) => Promise<{ ok: boolean; error?: string }>
        test: (hostId: string) => Promise<{ ok: boolean; result?: { ok: boolean; error?: string; uname?: string } }>
      }
      /** Telegram bot. Token stays in the main process. */
      telegram?: {
        status: () => Promise<TelegramStatusDto>
        /** Persisted chat bindings, so the bridge re-arms watchers after a restart. */
        bindings: () => Promise<{
          ok: boolean
          bindings: Array<{ chatId: string; projectId: string; sessionId: string; userId: string }>
        }>
        setEnabled: (enabled: boolean) => Promise<TelegramStatusDto>
        setToken: (token: string) => Promise<TelegramStatusDto | { ok: false; error: string }>
        clearToken: () => Promise<TelegramStatusDto>
        setProject: (projectId: string) => Promise<TelegramStatusDto | { ok: false; error: string }>
        approve: (code: string) => Promise<TelegramStatusDto | { ok: false; error: string }>
        deny: (code: string) => Promise<TelegramStatusDto | { ok: false; error: string }>
        revoke: (userId: string) => Promise<TelegramStatusDto | { ok: false; error: string }>
        allowUser: (userId: string) => Promise<TelegramStatusDto | { ok: false; error: string }>
        bindChat: (
          chatId: string,
          projectId: string,
          sessionId: string,
          userId: string
        ) => Promise<{ ok: boolean; error?: string }>
        reply: (chatId: string, text: string) => Promise<{ ok: boolean; error?: string }>
        progress: (chatId: string, text: string) => Promise<{ ok: boolean; error?: string }>
        askPermission: (
          chatId: string,
          requestId: string,
          summary: string
        ) => Promise<{ ok: boolean; error?: string }>
        listen: () => Promise<{ ok: boolean; events: TelegramEventDto[] }>
        onEvent: (callback: (event: TelegramEventDto) => void) => () => void
      }
      /** LLM-Wiki: interlinked markdown pages the agent maintains itself. */
      wiki?: {
        settings: () => Promise<WikiSettingsDto>
        setSettings: (partial: {
          enabled?: boolean
          injectIndex?: boolean
          injectMaxChars?: number
          logTail?: number
        }) => Promise<WikiSettingsDto>
        list: (input: {
          scope?: string
          projectId?: string | null
          query?: string
          limit?: number
          offset?: number
        }) => Promise<{ items: WikiPageDto[]; total: number }>
        read: (input: {
          ref: string
          scope?: string
          projectId?: string | null
        }) => Promise<{ ok: boolean; page?: WikiPageDto; error?: string }>
        write: (input: {
          title: string
          body: string
          summary?: string
          tags?: string[]
          scope?: string
          projectId?: string | null
        }) => Promise<{ ok: boolean; page?: WikiPageDto; created?: boolean; error?: string }>
        delete: (input: {
          slug: string
          scope?: string
          projectId?: string | null
        }) => Promise<{ ok: boolean; error?: string }>
        rename: (input: {
          from: string
          to: string
          scope?: string
          projectId?: string | null
        }) => Promise<{ ok: boolean; page?: WikiPageDto; rewritten?: number; error?: string }>
        search: (input: {
          query: string
          scope?: string
          projectId?: string | null
          limit?: number
        }) => Promise<Array<WikiPageDto & { scope: string; score: number; snippet: string }>>
        graph: (input: {
          scope?: string
          projectId?: string | null
        }) => Promise<WikiGraphDto>
        lint: (input: {
          scope?: string
          projectId?: string | null
          fix?: boolean
        }) => Promise<{
          ok: boolean
          issues: Array<{ type: string; slug: string; detail: string }>
          pages: number
        }>
        autolink: (input?: {
          scope?: string
          projectId?: string | null
        }) => Promise<{ ok: boolean; pagesTouched: number; linksAdded: number; seeAlsoAdded: number }>
        log: (input: {
          scope?: string
          projectId?: string | null
          limit?: number
        }) => Promise<Array<{ at: string; op: string; title: string; detail: string }>>
        digest: (opts?: { projectId?: string | null }) => Promise<string>
        stats: (input?: {
          scope?: string
          projectId?: string | null
        }) => Promise<{ pages: number; links: number; dir: string }>
      }
    }
  }

  interface ComputerResultDto {
    ok: boolean
    text: string
    image?: { dataUrl: string; width: number; height: number }
    data?: Record<string, unknown>
  }

  interface LspDiagnosticDto {
    /** 1-based line / column. */
    line: number
    column: number
    endLine?: number
    endColumn?: number
    severity: 'error' | 'warning' | 'info' | 'hint'
    message: string
    source?: string
    code?: string | number
  }

  interface LspLocationDto {
    path: string
    /** 1-based line / column. */
    line: number
    column: number
    endLine?: number
    endColumn?: number
    preview?: string
  }

  interface LspServerStatusDto {
    language: string
    server: string
    state: 'starting' | 'ready' | 'error' | 'unavailable' | 'stopped'
    error?: string
  }

  interface WikiPageDto {
    slug: string
    title: string
    summary: string
    tags: string[]
    created: string
    updated: string
    links: string[]
    backlinks: number
    chars: number
    body?: string
  }

  interface WikiSettingsDto {
    enabled: boolean
    injectIndex: boolean
    injectMaxChars: number
    logTail: number
  }

  interface WikiGraphDto {
    nodes: Array<{ id: string; title: string; degree: number; tags: string[]; updated: string }>
    edges: Array<{ source: string; target: string }>
  }
}
