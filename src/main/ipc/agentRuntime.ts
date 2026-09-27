import { handleTrusted } from './trust'
import { getPawnDir } from '../config'
import { createAgentRuntime, type AgentRuntime } from '../agentRuntime'

let runtime: AgentRuntime | null = null

export function getAgentRuntime(): AgentRuntime {
  if (!runtime) runtime = createAgentRuntime({ pawnDir: getPawnDir() })
  return runtime
}

/**
 * Agent runtime IPC: persistent bash, debugger, code index, affected tests,
 * port probes, offloaded outputs and repo profiles (see ../agentRuntime.ts).
 */
export function registerAgentRuntimeIpc(): void {
  const rt = getAgentRuntime()

  handleTrusted('bash:run', (_e, key: unknown, command: unknown, opts: unknown) => rt.bash.run(key, command, opts))
  handleTrusted('bash:restart', (_e, key: unknown, cwd: unknown, sandbox: unknown) => rt.bash.restart(key, cwd, sandbox))
  handleTrusted('bash:kill', async (_e, key: unknown) => rt.bash.kill(key))

  handleTrusted('debug:start', (_e, opts: unknown) => rt.debug.start(opts))
  handleTrusted('debug:setBreakpoints', (_e, key: unknown, path: unknown, lines: unknown) => rt.debug.setBreakpoints(key, path, lines))
  handleTrusted('debug:control', (_e, key: unknown, action: unknown, timeoutMs: unknown) => rt.debug.control(key, action, timeoutMs))
  handleTrusted('debug:evaluate', (_e, key: unknown, expression: unknown, frameId: unknown) => rt.debug.evaluate(key, expression, frameId))
  handleTrusted('debug:stop', (_e, key: unknown) => rt.debug.stop(key))
  handleTrusted('debug:list', async () => rt.debug.list())

  handleTrusted('codeIndex:search', (_e, root: unknown, queries: unknown, opts: unknown) => rt.codeIndex.search(root, queries, opts))
  handleTrusted('codeIndex:update', (_e, root: unknown) => rt.codeIndex.update(root))
  handleTrusted('tests:affected', (_e, root: unknown, files: unknown, opts: unknown) => rt.tests.affected(root, files, opts))
  handleTrusted('net:probePort', (_e, port: unknown, host: unknown) => rt.net.probePort(port, host))

  handleTrusted('outputs:save', (_e, sessionId: unknown, content: unknown) => rt.outputs.save(sessionId, content))
  handleTrusted('outputs:read', (_e, id: unknown, opts: unknown) => rt.outputs.read(id, opts))

  handleTrusted('profile:get', (_e, root: unknown) => rt.profile.get(root))
  handleTrusted('profile:save', (_e, root: unknown, json: unknown) => rt.profile.save(root, json))
}

export async function disposeAgentRuntime(): Promise<void> {
  await runtime?.dispose().catch(() => {})
}
