import { ipcMain } from 'electron'
import { handleTrusted } from './trust'
import * as db from '../db'

export function registerDbIpc(): void {
  handleTrusted('db:loadAll', async () => db.loadFullState())
  handleTrusted('db:addProject', async (_, id, name, path) => { db.addProject(id, name, path); return { ok: true } })
  handleTrusted('db:updateProjectName', async (_, id, name) => { db.updateProjectName(id, name); return { ok: true } })
  handleTrusted('db:updateProjectPaths', async (_, id, paths) => { db.updateProjectPaths(id, paths); return { ok: true } })
  handleTrusted('db:removeProject', async (_, id) => { db.removeProject(id); return { ok: true } })
  handleTrusted('db:addSession', async (_, id, projectId, title, path) => { db.addSession(id, projectId, title, path); return { ok: true } })
  handleTrusted('db:updateSessionTitle', async (_, id, title) => { db.updateSessionTitle(id, title); return { ok: true } })
  handleTrusted('db:updateSessionPath', async (_, id, path) => { db.updateSessionPath(id, path); return { ok: true } })
  handleTrusted('db:removeSession', async (_, id) => { db.removeSession(id); return { ok: true } })
  handleTrusted('db:addMessage', async (_, id, sessionId, role, content) => { db.addMessage(id, sessionId, role, content); return { ok: true } })
  handleTrusted('db:updateMessageContent', async (_, id, content) => { db.updateMessageContent(id, content); return { ok: true } })
  handleTrusted('db:deleteMessage', async (_, id) => { db.deleteMessage(id); return { ok: true } })
  handleTrusted('db:clearMessages', async (_, sessionId) => { db.clearMessages(sessionId); return { ok: true } })
  handleTrusted('db:getMessages', async (_, sessionId) => db.getMessagesBySession(sessionId))
  handleTrusted('db:getTranscript', async (_, sessionId) => db.getTranscript(sessionId))
  handleTrusted('db:saveTranscript', async (_, sessionId, json) => { db.saveTranscript(sessionId, json); return { ok: true } })
  handleTrusted('db:clearTranscript', async (_, sessionId) => { db.clearTranscript(sessionId); return { ok: true } })
  handleTrusted('db:addUsage', async (_, row) => { db.addUsage(row); return { ok: true } })
  handleTrusted('db:getUsageBySession', async (_, sessionId) => db.getUsageBySession(sessionId))
  handleTrusted('db:getUsageSummary', async (_, since) => db.getUsageSummary(since))
}
