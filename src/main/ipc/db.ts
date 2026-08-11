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
  handleTrusted('db:addMessage', async (_, id, sessionId, role, content, meta?) => {
    if (typeof id !== 'string' || typeof sessionId !== 'string') {
      return { ok: false, error: 'Invalid message args' }
    }
    const m =
      meta && typeof meta === 'object'
        ? (meta as { thinking?: string; modelLabel?: string })
        : undefined
    db.addMessage(id, sessionId, String(role || 'user'), typeof content === 'string' ? content : '', m)
    return { ok: true }
  })
  handleTrusted('db:updateMessageContent', async (_, id, content) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.updateMessageContent(id, typeof content === 'string' ? content : '')
    return { ok: true }
  })
  handleTrusted(
    'db:updateMessageMeta',
    async (_, id, meta: { thinking?: string; modelLabel?: string; content?: string }) => {
      if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
      db.updateMessageMeta(id, meta || {})
      return { ok: true }
    }
  )
  handleTrusted('db:getSessionPlan', async (_, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId) return null
    return db.getSessionPlan(sessionId)
  })
  handleTrusted('db:saveSessionPlan', async (_, sessionId, json) => {
    if (typeof sessionId !== 'string' || typeof json !== 'string') {
      return { ok: false, error: 'Invalid args' }
    }
    db.saveSessionPlan(sessionId, json)
    return { ok: true }
  })
  handleTrusted('db:getSessionAgentMode', async (_, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId) return null
    return db.getSessionAgentMode(sessionId)
  })
  handleTrusted('db:saveSessionAgentMode', async (_, sessionId, mode) => {
    if (typeof sessionId !== 'string' || typeof mode !== 'string') {
      return { ok: false, error: 'Invalid args' }
    }
    db.saveSessionAgentMode(sessionId, mode)
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
  handleTrusted('db:searchSessions', async (_, query) => {
    if (typeof query !== 'string') return []
    return db.searchSessions(query) || []
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

  // Mid-turn resume checkpoints
  handleTrusted('db:saveTurnCheckpoint', async (_, sessionId, projectId, status, json) => {
    if (typeof sessionId !== 'string' || typeof projectId !== 'string' || typeof json !== 'string') {
      return { ok: false, error: 'Invalid checkpoint args' }
    }
    const capped = json.length > 8_000_000 ? json.slice(0, 8_000_000) : json
    db.saveTurnCheckpoint(sessionId, projectId, String(status || 'running'), capped)
    return { ok: true }
  })
  handleTrusted('db:clearTurnCheckpoint', async (_, sessionId, status) => {
    if (typeof sessionId !== 'string') return { ok: false, error: 'Invalid session' }
    db.clearTurnCheckpoint(sessionId, typeof status === 'string' ? status : undefined)
    return { ok: true }
  })
  handleTrusted('db:listRunningTurnCheckpoints', async () => db.listRunningTurnCheckpoints())
  handleTrusted('db:getTurnCheckpoint', async (_, sessionId) => {
    if (typeof sessionId !== 'string') return null
    return db.getTurnCheckpoint(sessionId)
  })

  // Durable change ledger
  handleTrusted('db:saveChangeLedgerTurn', async (_, row) => {
    if (!row || typeof row !== 'object') return { ok: false, error: 'Invalid ledger row' }
    const r = row as {
      id?: string
      sessionId?: string
      projectId?: string
      createdAt?: number
      label?: string
      json?: string
    }
    if (typeof r.id !== 'string' || typeof r.sessionId !== 'string' || typeof r.json !== 'string') {
      return { ok: false, error: 'Invalid ledger fields' }
    }
    const capped = r.json.length > 12_000_000 ? r.json.slice(0, 12_000_000) : r.json
    db.saveChangeLedgerTurn({
      id: r.id,
      sessionId: r.sessionId,
      projectId: String(r.projectId || ''),
      createdAt: Number(r.createdAt) || Date.now(),
      label: String(r.label || ''),
      json: capped
    })
    return { ok: true }
  })
  handleTrusted('db:listChangeLedgerTurns', async (_, limit) =>
    db.listChangeLedgerTurns(typeof limit === 'number' ? limit : 80)
  )
  handleTrusted('db:deleteChangeLedgerTurn', async (_, id) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' }
    db.deleteChangeLedgerTurn(id)
    return { ok: true }
  })
  handleTrusted('db:deleteChangeLedgerForSession', async (_, sessionId) => {
    if (typeof sessionId !== 'string') return { ok: false, error: 'Invalid session' }
    db.deleteChangeLedgerForSession(sessionId)
    return { ok: true }
  })
}
