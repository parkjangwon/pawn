import { ipcMain } from 'electron'
import * as db from '../db'

export function registerDbIpc(): void {
  ipcMain.handle('db:loadAll', async () => db.loadFullState())
  ipcMain.handle('db:addProject', async (_, id, name, path) => { db.addProject(id, name, path); return { ok: true } })
  ipcMain.handle('db:updateProjectName', async (_, id, name) => { db.updateProjectName(id, name); return { ok: true } })
  ipcMain.handle('db:updateProjectPaths', async (_, id, paths) => { db.updateProjectPaths(id, paths); return { ok: true } })
  ipcMain.handle('db:removeProject', async (_, id) => { db.removeProject(id); return { ok: true } })
  ipcMain.handle('db:addSession', async (_, id, projectId, title, path) => { db.addSession(id, projectId, title, path); return { ok: true } })
  ipcMain.handle('db:updateSessionTitle', async (_, id, title) => { db.updateSessionTitle(id, title); return { ok: true } })
  ipcMain.handle('db:updateSessionPath', async (_, id, path) => { db.updateSessionPath(id, path); return { ok: true } })
  ipcMain.handle('db:removeSession', async (_, id) => { db.removeSession(id); return { ok: true } })
  ipcMain.handle('db:addMessage', async (_, id, sessionId, role, content) => { db.addMessage(id, sessionId, role, content); return { ok: true } })
  ipcMain.handle('db:updateMessageContent', async (_, id, content) => { db.updateMessageContent(id, content); return { ok: true } })
  ipcMain.handle('db:deleteMessage', async (_, id) => { db.deleteMessage(id); return { ok: true } })
  ipcMain.handle('db:clearMessages', async (_, sessionId) => { db.clearMessages(sessionId); return { ok: true } })
  ipcMain.handle('db:getMessages', async (_, sessionId) => db.getMessagesBySession(sessionId))
  ipcMain.handle('db:getTranscript', async (_, sessionId) => db.getTranscript(sessionId))
  ipcMain.handle('db:saveTranscript', async (_, sessionId, json) => { db.saveTranscript(sessionId, json); return { ok: true } })
  ipcMain.handle('db:clearTranscript', async (_, sessionId) => { db.clearTranscript(sessionId); return { ok: true } })
  ipcMain.handle('db:addUsage', async (_, row) => { db.addUsage(row); return { ok: true } })
  ipcMain.handle('db:getUsageBySession', async (_, sessionId) => db.getUsageBySession(sessionId))
  ipcMain.handle('db:getUsageSummary', async (_, since) => db.getUsageSummary(since))
}
