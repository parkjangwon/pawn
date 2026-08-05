import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getPawnDir } from '../config'

let memDb: Database.Database | null = null

export function getMemoryDb(): Database.Database {
  if (memDb) return memDb
  const dir = getPawnDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  memDb = new Database(join(dir, 'memory.db'))
  memDb.pragma('journal_mode = WAL')
  memDb.pragma('foreign_keys = ON')
  initMemorySchema(memDb)
  return memDb
}

export function closeMemoryDb(): void {
  try {
    memDb?.close()
  } catch {
    /* ignore */
  }
  memDb = null
}

function initMemorySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('user', 'project')),
      project_id TEXT,
      kind TEXT NOT NULL DEFAULT 'other',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'agent',
      confidence REAL NOT NULL DEFAULT 0.7,
      pinned INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      content_hash TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
    CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(pinned);
    CREATE INDEX IF NOT EXISTS idx_memories_enabled ON memories(enabled);
    CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
    CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title,
      content,
      tags,
      content='memories',
      content_rowid='rowid'
    );

    -- Keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, title, content, tags)
      VALUES (new.rowid, new.title, new.content, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
      VALUES ('delete', old.rowid, old.title, old.content, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
      VALUES ('delete', old.rowid, old.title, old.content, old.tags);
      INSERT INTO memories_fts(rowid, title, content, tags)
      VALUES (new.rowid, new.title, new.content, new.tags);
    END;

    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Rebuild FTS if empty but memories exist (migration / corrupted fts)
  const memCount = (db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }).c
  const ftsCount = (db.prepare('SELECT COUNT(*) AS c FROM memories_fts').get() as { c: number }).c
  if (memCount > 0 && ftsCount === 0) {
    db.exec(`
      INSERT INTO memories_fts(rowid, title, content, tags)
      SELECT rowid, title, content, tags FROM memories;
    `)
  }
}
