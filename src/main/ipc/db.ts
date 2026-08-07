import { ipcMain } from 'electron'
import { handleTrusted } from './trust'
import * as db from '../db'

export function registerDbIpc(): void {
  handleTrusted('db:loadAll', async () => db.loadFullState())
  handleTrusted('db:addProject', async (_, id, name, path) => {
    if (typeof id !== 'string' || !id) return { ok: false, error: 'Invalid project id' }
    db.addProject(id, String(name || 'Project'), typeof path === 'string' ? path : '[]')
    return { ok: true }
  })
  handleTrusted('db:updateProjectName', async (_, id, name) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.updateProjectName(id, String(name || ''))
    return { ok: true }
  })
  handleTrusted('db:updateProjectPaths', async (_, id, paths) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.updateProjectPaths(id, typeof paths === 'string' ? paths : '[]')
    return { ok: true }
  })
  handleTrusted('db:removeProject', async (_, id) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.removeProject(id)
    return { ok: true }
  })
  handleTrusted('db:addSession', async (_, id, projectId, title, path) => {
    if (typeof id !== 'string' || typeof projectId !== 'string') {
      return { ok: false, error: 'Invalid session args' }
    }
    db.addSession(id, projectId, String(title || 'New Session'), typeof path === 'string' ? path : '')
    return { ok: true }
  })
  handleTrusted('db:updateSessionTitle', async (_, id, title) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.updateSessionTitle(id, String(title || ''))
    return { ok: true }
  })
  handleTrusted('db:updateSessionPath', async (_, id, path) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.updateSessionPath(id, typeof path === 'string' ? path : '')
    return { ok: true }
  })
  handleTrusted('db:removeSession', async (_, id) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.removeSession(id)
    return { ok: true }
  })
  handleTrusted('db:addMessage', async (_, id, sessionId, role, content) => {
    if (typeof id !== 'string' || typeof sessionId !== 'string') {
      return { ok: false, error: 'Invalid message args' }
    }
    db.addMessage(id, sessionId, String(role || 'user'), typeof content === 'string' ? content : '')
    return { ok: true }
  })
  handleTrusted('db:updateMessageContent', async (_, id, content) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.updateMessageContent(id, typeof content === 'string' ? content : '')
    return { ok: true }
  })
  handleTrusted('db:deleteMessage', async (_, id) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.deleteMessage(id)
    return { ok: true }
  })
  handleTrusted('db:clearMessages', async (_, sessionId) => {
    if (typeof sessionId !== 'string') return { ok: false, error: 'Invalid session' }
    db.clearMessages(sessionId)
    return { ok: true }
  })
  handleTrusted('db:getMessages', async (_, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId) return []
    return db.getMessagesBySession(sessionId) || []
  })
  handleTrusted('db:getTranscript', async (_, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId) return null
    return db.getTranscript(sessionId)
  })
  handleTrusted('db:saveTranscript', async (_, sessionId, json) => {
    if (typeof sessionId !== 'string' || typeof json !== 'string') {
      return { ok: false, error: 'Invalid transcript args' }
    }
    // Cap oversized transcripts so a runaway agent cannot blow up SQLite.
    const capped = json.length > 8_000_000 ? json.slice(0, 8_000_000) : json
    db.saveTranscript(sessionId, capped)
    return { ok: true }
  })
  handleTrusted('db:clearTranscript', async (_, sessionId) => {
    if (typeof sessionId !== 'string') return { ok: false, error: 'Invalid session' }
    db.clearTranscript(sessionId)
    return { ok: true }
  })
  handleTrusted('db:addUsage', async (_, row) => {
    if (!row || typeof row !== 'object') return { ok: false, error: 'Invalid usage row' }
    db.addUsage(row)
    return { ok: true }
  })
  handleTrusted('db:getUsageBySession', async (_, sessionId) => {
    if (typeof sessionId !== 'string') return []
    return db.getUsageBySession(sessionId) || []
  })
  handleTrusted('db:getUsageSummary', async (_, since) => db.getUsageSummary(since))
}
