import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { getPawnDir } from './config'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dir = getPawnDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'pawn.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Session',
      path TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      session_id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS usage (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      prompt TEXT NOT NULL,
      project_id TEXT DEFAULT '',
      session_id TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER NOT NULL DEFAULT 0,
      last_result TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_routines_enabled ON routines(enabled);

    -- Mid-turn agent resume state (one running checkpoint per session).
    CREATE TABLE IF NOT EXISTS turn_checkpoints (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Durable file-change undo ledger (survives app restarts).
    CREATE TABLE IF NOT EXISTS change_ledger (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      json TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_change_ledger_session ON change_ledger(session_id);
    CREATE INDEX IF NOT EXISTS idx_change_ledger_created ON change_ledger(created_at);
  `)

  // The usage ledger grows one row per LLM call forever; prune anything older
  // than 90 days on every launch so the database does not balloon over time.
  db.prepare('DELETE FROM usage WHERE created_at < ?')
    .run(Math.floor(Date.now() / 1000) - 90 * 86400)

  // Drop abandoned running checkpoints older than 7 days.
  db.prepare(
    `DELETE FROM turn_checkpoints WHERE status = 'running' AND updated_at < ?`
  ).run(Math.floor(Date.now() / 1000) - 7 * 86400)

  // Cap durable change ledger to the newest 200 turns globally.
  db.prepare(
    `DELETE FROM change_ledger WHERE id NOT IN (
       SELECT id FROM change_ledger ORDER BY created_at DESC LIMIT 200
     )`
  ).run()
}

// --- Projects ---

export function getAllProjects(): Array<{ id: string; name: string; path: string; createdAt: number }> {
  return getDb().prepare('SELECT id, name, path, created_at as createdAt FROM projects ORDER BY created_at').all() as never[]
}

export function addProject(id: string, name: string, path: string): void {
  getDb().prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(id, name, path)
}

export function updateProjectName(id: string, name: string): void {
  getDb().prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id)
}

export function updateProjectPaths(id: string, paths: string): void {
  getDb().prepare('UPDATE projects SET path = ? WHERE id = ?').run(paths, id)
}

export function removeProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}

// --- Sessions ---

export function getSessionsByProject(projectId: string): Array<{ id: string; title: string; path: string; createdAt: number }> {
  return getDb().prepare('SELECT id, title, path, created_at as createdAt FROM sessions WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as never[]
}

export function addSession(id: string, projectId: string, title: string, path: string): void {
  getDb().prepare('INSERT INTO sessions (id, project_id, title, path) VALUES (?, ?, ?, ?)').run(id, projectId, title, path)
}

export function updateSessionTitle(id: string, title: string): void {
  getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
}

export function updateSessionPath(id: string, path: string): void {
  getDb().prepare('UPDATE sessions SET path = ? WHERE id = ?').run(path || null, id)
}

export function removeSession(id: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

// --- Messages ---

export function getMessagesBySession(sessionId: string): Array<{ id: string; role: string; content: string; createdAt: number }> {
  return getDb().prepare('SELECT id, role, content, created_at as createdAt FROM messages WHERE session_id = ? ORDER BY created_at').all(sessionId) as never[]
}

export function addMessage(id: string, sessionId: string, role: string, content: string): void {
  getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(id, sessionId, role, content)
}

export function deleteMessage(id: string): void {
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(id)
}

export function updateMessageContent(id: string, content: string): void {
  getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
}

export function clearMessages(sessionId: string): void {
  const d = getDb()
  d.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  // The replayed transcript must die with the visible history, otherwise a
  // "cleared" session keeps sending the old conversation to the model.
  d.prepare('DELETE FROM transcripts WHERE session_id = ?').run(sessionId)
  d.prepare('DELETE FROM turn_checkpoints WHERE session_id = ?').run(sessionId)
}

// --- API transcripts ---
// The exact provider-neutral conversation the agent replays. Kept apart from the
// display `messages` table so the wire prefix stays byte-stable across turns,
// which is what makes prompt caching actually hit.

export function getTranscript(sessionId: string): string | null {
  const row = getDb().prepare('SELECT json FROM transcripts WHERE session_id = ?').get(sessionId) as
    | { json: string }
    | undefined
  return row?.json ?? null
}

export function saveTranscript(sessionId: string, json: string): void {
  getDb()
    .prepare(
      `INSERT INTO transcripts (session_id, json, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(session_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
    )
    .run(sessionId, json)
}

export function clearTranscript(sessionId: string): void {
  getDb().prepare('DELETE FROM transcripts WHERE session_id = ?').run(sessionId)
}

// --- Turn checkpoints (mid-turn resume) ---

export function saveTurnCheckpoint(
  sessionId: string,
  projectId: string,
  status: string,
  json: string
): void {
  getDb()
    .prepare(
      `INSERT INTO turn_checkpoints (session_id, project_id, status, json, updated_at)
       VALUES (?, ?, ?, ?, unixepoch())
       ON CONFLICT(session_id) DO UPDATE SET
         project_id = excluded.project_id,
         status = excluded.status,
         json = excluded.json,
         updated_at = excluded.updated_at`
    )
    .run(sessionId, projectId, status || 'running', json)
}

export function clearTurnCheckpoint(sessionId: string, status?: string): void {
  if (status && status !== 'running') {
    // Keep a terminal marker briefly so restart does not re-resume a just-finished turn.
    getDb()
      .prepare(
        `UPDATE turn_checkpoints SET status = ?, updated_at = unixepoch() WHERE session_id = ?`
      )
      .run(status, sessionId)
    return
  }
  getDb().prepare('DELETE FROM turn_checkpoints WHERE session_id = ?').run(sessionId)
}

export function listRunningTurnCheckpoints(): Array<{
  sessionId: string
  projectId: string
  status: string
  json: string
  updatedAt: number
}> {
  return getDb()
    .prepare(
      `SELECT session_id as sessionId, project_id as projectId, status, json,
              updated_at as updatedAt
       FROM turn_checkpoints WHERE status = 'running' ORDER BY updated_at DESC`
    )
    .all() as never[]
}

export function getTurnCheckpoint(sessionId: string): {
  sessionId: string
  projectId: string
  status: string
  json: string
  updatedAt: number
} | null {
  const row = getDb()
    .prepare(
      `SELECT session_id as sessionId, project_id as projectId, status, json,
              updated_at as updatedAt
       FROM turn_checkpoints WHERE session_id = ?`
    )
    .get(sessionId) as
    | { sessionId: string; projectId: string; status: string; json: string; updatedAt: number }
    | undefined
  return row ?? null
}

// --- Durable change ledger ---

export function saveChangeLedgerTurn(row: {
  id: string
  sessionId: string
  projectId: string
  createdAt: number
  label: string
  json: string
}): void {
  getDb()
    .prepare(
      `INSERT INTO change_ledger (id, session_id, project_id, created_at, label, json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, label = excluded.label`
    )
    .run(
      row.id,
      row.sessionId,
      row.projectId,
      Math.floor(row.createdAt / 1000) || Math.floor(Date.now() / 1000),
      row.label || '',
      row.json
    )
}

export function listChangeLedgerTurns(limit = 80): Array<{
  id: string
  sessionId: string
  projectId: string
  createdAt: number
  label: string
  json: string
}> {
  return getDb()
    .prepare(
      `SELECT id, session_id as sessionId, project_id as projectId,
              created_at as createdAt, label, json
       FROM change_ledger ORDER BY created_at DESC LIMIT ?`
    )
    .all(Math.min(200, Math.max(1, limit))) as never[]
}

export function deleteChangeLedgerTurn(id: string): void {
  getDb().prepare('DELETE FROM change_ledger WHERE id = ?').run(id)
}

export function deleteChangeLedgerForSession(sessionId: string): void {
  getDb().prepare('DELETE FROM change_ledger WHERE session_id = ?').run(sessionId)
}

// --- Usage / cost ---

export interface UsageRow {
  id: string
  sessionId: string
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  createdAt: number
}

export function addUsage(row: Omit<UsageRow, 'createdAt'>): void {
  getDb()
    .prepare(
      `INSERT INTO usage (id, session_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id, row.sessionId, row.providerId, row.modelId,
      row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens, row.cost
    )
}

export function getUsageBySession(sessionId: string): UsageRow[] {
  return getDb()
    .prepare(
      `SELECT id, session_id as sessionId, provider_id as providerId, model_id as modelId,
              input_tokens as inputTokens, output_tokens as outputTokens,
              cache_read_tokens as cacheReadTokens, cache_write_tokens as cacheWriteTokens,
              cost, created_at as createdAt
       FROM usage WHERE session_id = ? ORDER BY created_at`
    )
    .all(sessionId) as UsageRow[]
}

export function getUsageSummary(sinceEpochSeconds: number): Array<{
  modelId: string
  providerId: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}> {
  return getDb()
    .prepare(
      `SELECT model_id as modelId, provider_id as providerId, COUNT(*) as calls,
              SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens,
              SUM(cache_read_tokens) as cacheReadTokens, SUM(cache_write_tokens) as cacheWriteTokens,
              SUM(cost) as cost
       FROM usage WHERE created_at >= ? GROUP BY provider_id, model_id ORDER BY cost DESC`
    )
    .all(sinceEpochSeconds) as never[]
}

// --- Full state load (for initial app load) ---
// Messages are NOT included here; they are loaded lazily per session via db:getMessages.

export function loadFullState(): {
  projects: Array<{ id: string; name: string; path: string; sessions: Array<{ id: string; title: string; path: string; createdAt: number }> }>
} {
  const projects = getAllProjects()
  const result = projects.map((p) => ({
    ...p,
    sessions: getSessionsByProject(p.id)
  }))
  return { projects: result }
}

// --- Routines (recurring tasks) ---

export interface RoutineRow {
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

function mapRoutine(row: Record<string, unknown>): RoutineRow {
  return {
    id: row.id as string,
    name: row.name as string,
    schedule: row.schedule as string,
    prompt: row.prompt as string,
    projectId: row.projectId as string,
    sessionId: row.sessionId as string,
    enabled: (row.enabled as number) === 1,
    nextRunAt: row.nextRunAt as number,
    lastRunAt: row.lastRunAt as number,
    lastResult: row.lastResult as string,
    createdAt: row.createdAt as number
  }
}

export function getAllRoutines(): RoutineRow[] {
  return (
    getDb()
      .prepare(
        `SELECT id, name, schedule, prompt, project_id as projectId, session_id as sessionId,
                enabled, next_run_at as nextRunAt, last_run_at as lastRunAt,
                last_result as lastResult, created_at as createdAt
         FROM routines ORDER BY created_at`
      )
      .all() as Record<string, unknown>[]
  ).map(mapRoutine)
}

export function addRoutine(row: {
  id: string
  name: string
  schedule: string
  prompt: string
  projectId: string
  sessionId: string
  nextRunAt: number
}): void {
  getDb()
    .prepare(
      `INSERT INTO routines (id, name, schedule, prompt, project_id, session_id, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(row.id, row.name, row.schedule, row.prompt, row.projectId, row.sessionId, row.nextRunAt)
}

export function updateRoutine(
  id: string,
  patch: Partial<{
    name: string
    schedule: string
    prompt: string
    projectId: string
    sessionId: string
    enabled: boolean
    nextRunAt: number
  }>
): void {
  const d = getDb()
  const current = d.prepare('SELECT * FROM routines WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!current) return
  d.prepare(
    `UPDATE routines SET
       name = ?, schedule = ?, prompt = ?, project_id = ?, session_id = ?,
       enabled = ?, next_run_at = ?
     WHERE id = ?`
  ).run(
    patch.name ?? (current.name as string),
    patch.schedule ?? (current.schedule as string),
    patch.prompt ?? (current.prompt as string),
    patch.projectId ?? (current.project_id as string),
    patch.sessionId ?? (current.session_id as string),
    patch.enabled === undefined ? (current.enabled as number) : patch.enabled ? 1 : 0,
    patch.nextRunAt ?? (current.next_run_at as number),
    id
  )
}

export function removeRoutine(id: string): void {
  getDb().prepare('DELETE FROM routines WHERE id = ?').run(id)
}

/** Advance the run state after a routine fires or completes. */
export function setRoutineRunState(id: string, nextRunAt: number, lastRunAt: number, lastResult: string): void {
  getDb()
    .prepare('UPDATE routines SET next_run_at = ?, last_run_at = ?, last_result = ? WHERE id = ?')
    .run(nextRunAt, lastRunAt, lastResult, id)
}
