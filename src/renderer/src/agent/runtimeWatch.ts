/**
 * Runtime perception: what running programs are telling the agent.
 *
 *  - analyzeProcessOutput: URLs / ports a dev server announced, readiness,
 *    and error lines (stack traces, compile errors, crashes).
 *  - Background jobs started by a session are watched; new error output is
 *    surfaced to the agent after each tool round without it having to poll.
 *  - Browser console errors / exceptions / failed requests since the agent's
 *    last look are surfaced the same way.
 */

export interface ProcessAnalysis {
  urls: string[]
  ports: number[]
  ready: boolean
  errors: string[]
}

const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w.-]+\.local)(?::\d{2,5})?(?:\/[^\s'"<>)]*)?/gi
const PORT_RE = /\b(?:port|listening on|listening at|running on|started on|serving on)\b[^\n\d]{0,24}(\d{2,5})\b/gi
const READY_RE =
  /\b(ready in|compiled successfully|compiled client and server|listening on|listening at|server (is )?running|started server|local:\s+https?:|webpack compiled|build finished|watching for (file )?changes|application startup complete|development server)\b/i
const ERROR_RE =
  /(\berror\b|\bexception\b|traceback \(most recent call last\)|\bfatal\b|\bpanic(ked)?\b|\bERR!|\bEADDRINUSE\b|\bECONNREFUSED\b|cannot find module|module not found|unhandled(promise)?rejection|segmentation fault|\bfailed to compile\b|\bsyntaxerror\b|\btypeerror\b|\breferenceerror\b|\bundefined is not\b)/i
const NOT_ERROR_RE = /\b(0 errors?|no errors?|errors?: 0|without errors|error-free|errorhandler|\.error\(|onerror|error\.tsx?|errors\.ts)\b/i

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')
}

export function analyzeProcessOutput(text: string): ProcessAnalysis {
  const clean = stripAnsi(text || '')
  const urls = new Set<string>()
  const ports = new Set<number>()
  for (const m of Array.from(clean.matchAll(URL_RE))) {
    const u = m[0].replace(/[.,;:]+$/, '')
    urls.add(u)
    const p = /:(\d{2,5})(?:\/|$)/.exec(u)
    if (p) ports.add(Number(p[1]))
  }
  for (const m of Array.from(clean.matchAll(PORT_RE))) {
    const n = Number(m[1])
    if (n >= 80 && n <= 65535) ports.add(n)
  }
  const errors: string[] = []
  const lines = clean.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.length > 1000) continue
    if (ERROR_RE.test(line) && !NOT_ERROR_RE.test(line)) {
      errors.push(line.slice(0, 300))
      // Keep the first frame of a stack trace for context.
      const next = (lines[i + 1] || '').trim()
      if (/^at\s|^File "/.test(next)) errors.push(`  ${next.slice(0, 300)}`)
    }
  }
  return { urls: Array.from(urls).slice(0, 8), ports: Array.from(ports).slice(0, 8), ready: READY_RE.test(clean), errors: dedupe(errors).slice(-20) }
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of list) {
    if (seen.has(l)) continue
    seen.add(l)
    out.push(l)
  }
  return out
}

export function formatAnalysis(a: ProcessAnalysis): string {
  const parts: string[] = []
  if (a.urls.length) parts.push(`urls: ${a.urls.join(', ')}`)
  else if (a.ports.length) parts.push(`ports: ${a.ports.join(', ')}`)
  if (a.ready) parts.push('looks ready')
  if (a.errors.length) parts.push(`${a.errors.length} error line${a.errors.length === 1 ? '' : 's'}`)
  return parts.length ? `[detected] ${parts.join(' · ')}` : ''
}

// --- per-session watch state ---------------------------------------------------

interface JobWatch {
  jobId: string
  command: string
  seenChars: number
}

const jobsBySession = new Map<string, JobWatch[]>()
const browserSeqByOwner = new Map<string, number>()

export function watchJob(sessionKey: string, jobId: string, command: string): void {
  const list = jobsBySession.get(sessionKey) || []
  if (!list.some((j) => j.jobId === jobId)) list.push({ jobId, command, seenChars: 0 })
  jobsBySession.set(sessionKey, list.slice(-10))
}

/** The agent looked at this job's output itself (shell_poll / shell_wait). */
export function markJobSeen(sessionKey: string, jobId: string, chars: number): void {
  const j = jobsBySession.get(sessionKey)?.find((x) => x.jobId === jobId)
  if (j) j.seenChars = Math.max(j.seenChars, chars)
}

export function noteBrowserSeq(owner: string, seq: number): void {
  if (seq > (browserSeqByOwner.get(owner) || 0)) browserSeqByOwner.set(owner, seq)
}

export function browserSeq(owner: string): number {
  return browserSeqByOwner.get(owner) || 0
}

export function forgetRuntimeWatch(sessionKey: string): void {
  jobsBySession.delete(sessionKey)
}

type PollFn = (jobId: string) => Promise<{ status?: string; stdout?: string; stderr?: string; exitCode?: number | null; error?: string }>
type RuntimeFn = (
  owner?: string,
  opts?: { since?: number; minLevel?: string; limit?: number }
) => Promise<{ ok: boolean; events: Array<{ kind: string; level: string; text: string; url?: string; status?: number; method?: string; source?: string }>; latestSeq: number }>

/**
 * New problems since the last collection: error lines from watched
 * background jobs (and jobs that exited non-zero), plus browser errors.
 * Returns '' when there is nothing new.
 */
export async function collectRuntimeEvents(opts: {
  sessionKey: string
  browserOwner?: string
  poll?: PollFn
  runtime?: RuntimeFn
  includeBrowser: boolean
}): Promise<string> {
  const out: string[] = []
  const jobs = jobsBySession.get(opts.sessionKey) || []
  if (opts.poll) {
    const running: JobWatch[] = []
    for (const j of jobs) {
      const r = await opts.poll(j.jobId).catch(() => null)
      if (!r || r.error) continue
      const all = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`
      const fresh = all.slice(j.seenChars)
      j.seenChars = all.length
      const errs = analyzeProcessOutput(fresh).errors
      if (errs.length) out.push(`- job ${j.jobId} (${j.command.slice(0, 60)}): ${errs.slice(-5).join(' | ').slice(0, 600)}`)
      if (r.status === 'exited') {
        // Reported once, then no longer watched.
        if (typeof r.exitCode === 'number' && r.exitCode !== 0) out.push(`- job ${j.jobId} exited with code ${r.exitCode}`)
      } else {
        running.push(j)
      }
    }
    jobsBySession.set(opts.sessionKey, running)
  }
  if (opts.includeBrowser && opts.runtime && opts.browserOwner) {
    const res = await opts.runtime(opts.browserOwner, { since: browserSeq(opts.browserOwner), minLevel: 'warn', limit: 20 }).catch(() => null)
    if (res?.ok) {
      noteBrowserSeq(opts.browserOwner, res.latestSeq)
      const serious = res.events.filter((e) => e.level === 'error' || e.kind === 'network')
      for (const e of serious.slice(-8)) {
        out.push(
          e.kind === 'network'
            ? `- page request failed: ${e.method || 'GET'} ${e.url} → ${e.status ?? e.text}`
            : `- page ${e.kind === 'exception' ? 'exception' : e.kind === 'crash' ? 'crash' : 'console error'}: ${e.text.slice(0, 300)}${e.source ? ` (${e.source})` : ''}`
        )
      }
    }
  }
  if (!out.length) return ''
  return `<runtime_events>\nNew problems reported by running programs since your last step:\n${out.join('\n')}\n</runtime_events>`
}
