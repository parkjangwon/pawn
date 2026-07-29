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

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
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

export function updateMessageContent(id: string, content: string): void {
  getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
}

export function clearMessages(sessionId: string): void {
  getDb().prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
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
