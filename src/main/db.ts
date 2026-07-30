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

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at);
  `)
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
