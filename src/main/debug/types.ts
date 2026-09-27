export type DebugLanguage = 'node' | 'python' | 'go' | 'lldb'

export interface DebugBreakpoint {
  path: string
  line: number
  condition?: string
}

export interface DebugStartOptions {
  sessionKey: string
  language?: DebugLanguage | 'auto'
  program: string
  args?: string[]
  cwd: string
  env?: Record<string, string>
  stopOnEntry?: boolean
  breakpoints?: DebugBreakpoint[]
  runtimeExecutable?: string
  runtimeArgs?: string[]
  timeoutMs?: number
}

export interface DebugFrame {
  id: number
  name: string
  path?: string
  line: number
  column?: number
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  ref?: number
}

export interface DebugState {
  sessionKey: string
  language: DebugLanguage
  status: 'starting' | 'running' | 'stopped' | 'terminated'
  reason?: string
  description?: string
  threadId?: number
  location?: { path?: string; line: number; column?: number; function?: string }
  source?: string
  stack?: DebugFrame[]
  locals?: DebugVariable[]
  exception?: string
  output: string
  exitCode?: number
  breakpoints?: Array<{ path: string; line: number; verified: boolean; message?: string }>
}
