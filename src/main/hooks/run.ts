import { spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import type {
  HookDecision,
  HookEventName,
  HookRunInput,
  HookRunResult,
  LoadedHook
} from './types'
import { loadAllHooks } from './load'
import { hookMatchesEvent } from './match'
import { getHooksSettings } from './settings'

function expandPlaceholders(command: string, projectPath?: string | null): string {
  let out = command
  if (projectPath) {
    out = out
      .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, projectPath)
      .replace(/\$CLAUDE_PROJECT_DIR/g, projectPath)
      .replace(/\$\{PAWN_PROJECT_DIR\}/g, projectPath)
      .replace(/\$PAWN_PROJECT_DIR/g, projectPath)
  }
  return out
}

function runCommand(
  command: string,
  stdinJson: string,
  opts: { cwd?: string; timeoutSec: number; env: NodeJS.ProcessEnv }
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd || process.cwd(),
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 500)
    }, Math.max(1, opts.timeoutSec) * 1000)

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8')
      if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000)
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8')
      if (stderr.length > 50_000) stderr = stderr.slice(0, 50_000)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: stderr || String(err), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    try {
      child.stdin?.write(stdinJson)
      child.stdin?.end()
    } catch {
      /* ignore */
    }
  })
}

async function runHttp(
  url: string,
  body: string,
  timeoutSec: number
): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutSec) * 1000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text: text.slice(0, 200_000) }
  } catch (e) {
    return { ok: false, status: 0, text: '', error: String(e) }
  } finally {
    clearTimeout(timer)
  }
}

function parseDecision(stdout: string, event: HookEventName, exitCode: number | null): {
  decision: HookDecision
  reason?: string
  additionalContext?: string
} {
  // Exit 2 = block (Claude convention)
  if (exitCode === 2) {
    return { decision: 'deny', reason: 'Hook exit code 2' }
  }

  const trimmed = (stdout || '').trim()
  if (!trimmed) return { decision: 'none' }

  // Try JSON
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>
    const hso = j.hookSpecificOutput as Record<string, unknown> | undefined
    const add =
      (hso?.additionalContext != null ? String(hso.additionalContext) : undefined) ||
      (j.additionalContext != null ? String(j.additionalContext) : undefined)

    if (event === 'PreToolUse' || event === 'PermissionRequest') {
      const perm = hso?.permissionDecision != null ? String(hso.permissionDecision) : undefined
      if (perm === 'deny' || perm === 'block') {
        return {
          decision: 'deny',
          reason: hso?.permissionDecisionReason != null ? String(hso.permissionDecisionReason) : 'Denied by hook',
          additionalContext: add
        }
      }
      if (perm === 'allow') return { decision: 'allow', additionalContext: add }
      if (perm === 'ask') return { decision: 'ask', additionalContext: add }

      const decision = j.decision != null ? String(j.decision) : undefined
      if (decision === 'block' || decision === 'deny') {
        return { decision: 'deny', reason: j.reason != null ? String(j.reason) : 'Blocked by hook', additionalContext: add }
      }

      // PermissionRequest Codex shape
      const dec = hso?.decision as Record<string, unknown> | undefined
      if (dec?.behavior === 'deny') {
        return {
          decision: 'deny',
          reason: dec.message != null ? String(dec.message) : 'Denied by hook',
          additionalContext: add
        }
      }
      if (dec?.behavior === 'allow') return { decision: 'allow', additionalContext: add }
    }

    if (j.continue === false) {
      return {
        decision: 'deny',
        reason: j.stopReason != null ? String(j.stopReason) : 'Hook requested stop',
        additionalContext: add
      }
    }

    if (add) return { decision: 'none', additionalContext: add }
    // Plain success JSON without decision
    return { decision: 'none', additionalContext: add }
  } catch {
    // Non-JSON stdout: for SessionStart/UserPromptSubmit treat as additional context
    if (event === 'SessionStart' || event === 'UserPromptSubmit' || event === 'Stop') {
      return { decision: 'none', additionalContext: trimmed.slice(0, 4000) }
    }
    return { decision: 'none' }
  }
}

export async function runHooks(input: HookRunInput): Promise<HookRunResult> {
  const settings = getHooksSettings()
  if (!settings.enabled) {
    return { ok: true, decision: 'none', additionalContext: [], ran: 0, errors: [] }
  }

  const all = loadAllHooks(input.projectPath)
  const toolName =
    input.payload?.tool_name != null
      ? String(input.payload.tool_name)
      : input.payload?.toolName != null
        ? String(input.payload.toolName)
        : undefined

  const matched = all.filter((h) =>
    hookMatchesEvent(h, input.event, {
      toolName,
      source: input.payload?.source != null ? String(input.payload.source) : undefined,
      reason: input.payload?.reason != null ? String(input.payload.reason) : undefined
    })
  )

  if (!matched.length) {
    return { ok: true, decision: 'none', additionalContext: [], ran: 0, errors: [] }
  }

  const cwd = input.cwd || input.projectPath || process.cwd()
  const sessionId = input.sessionId || 'unknown'
  const basePayload = {
    session_id: sessionId,
    cwd,
    hook_event_name: input.event,
    ...input.payload
  }
  const stdinJson = JSON.stringify(basePayload)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PAWN_SESSION_ID: sessionId,
    PAWN_HOOK_EVENT: input.event
  }
  if (input.projectPath) {
    env.PAWN_PROJECT_DIR = input.projectPath
    env.CLAUDE_PROJECT_DIR = input.projectPath
  }

  // Run in parallel; collect decisions
  const results = await Promise.all(
    matched.map(async (h: LoadedHook) => {
      const timeoutSec =
        h.handler.timeout != null && Number.isFinite(h.handler.timeout)
          ? Number(h.handler.timeout)
          : input.event === 'PermissionRequest'
            ? 120
            : 30

      try {
        if (h.handler.type === 'http' && h.handler.url) {
          const res = await runHttp(h.handler.url, stdinJson, timeoutSec)
          if (!res.ok && res.status === 0) {
            return {
              decision: 'none' as HookDecision,
              error: res.error || 'HTTP hook failed',
              additionalContext: undefined as string | undefined
            }
          }
          // Non-2xx: non-blocking (Claude HTTP convention) unless body says deny
          const parsed = parseDecision(res.text, input.event, res.ok ? 0 : 1)
          return { ...parsed, error: undefined as string | undefined }
        }

        const command = expandPlaceholders(h.handler.command || '', input.projectPath)
        const res = await runCommand(command, stdinJson, { cwd, timeoutSec, env })
        if (res.timedOut) {
          return {
            decision: 'none' as HookDecision,
            error: `Hook timed out (${timeoutSec}s): ${h.id}`,
            additionalContext: undefined as string | undefined
          }
        }
        const parsed = parseDecision(res.stdout || res.stderr, input.event, res.code)
        // Non-zero (except 2 already deny) → non-blocking error
        if (res.code && res.code !== 0 && parsed.decision === 'none') {
          return {
            decision: 'none' as HookDecision,
            error: res.stderr?.trim() || `Hook exit ${res.code}`,
            additionalContext: parsed.additionalContext
          }
        }
        return { ...parsed, error: undefined as string | undefined }
      } catch (e) {
        return {
          decision: 'none' as HookDecision,
          error: String(e),
          additionalContext: undefined as string | undefined
        }
      }
    })
  )

  let decision: HookDecision = 'none'
  let reason: string | undefined
  const additionalContext: string[] = []
  const errors: string[] = []

  for (const r of results) {
    if (r.error) errors.push(r.error)
    if (r.additionalContext) additionalContext.push(r.additionalContext)
    if (r.decision === 'deny') {
      decision = 'deny'
      reason = r.reason || reason
    } else if (r.decision === 'allow' && decision !== 'deny') {
      decision = 'allow'
    } else if (r.decision === 'ask' && decision === 'none') {
      decision = 'ask'
    }
  }

  return {
    ok: decision !== 'deny',
    decision,
    reason,
    additionalContext,
    ran: matched.length,
    errors
  }
}

/** Stable id helper for tests */
export function hashPayload(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
}

export function newHookTraceId(): string {
  return randomUUID().slice(0, 8)
}
