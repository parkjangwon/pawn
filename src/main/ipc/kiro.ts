import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { app, safeStorage, shell } from 'electron'
import { handleTrusted } from './trust'
import { getPawnDir } from '../config'
import { getMainWindow } from '../window'
import { createKiroService, type KiroService } from '../kiro/service'
import type { KiroCredentials, KiroSecureStore } from '../kiro/auth'

/**
 * Kiro credentials live in ~/.pawn/kiro.json, encrypted with the OS keychain
 * (safeStorage). Without keychain encryption they are kept in memory only —
 * tokens are never written to disk in plain text.
 */
function secureStore(): KiroSecureStore {
  const path = join(getPawnDir(), 'kiro.json')
  let memory: KiroCredentials | null = null
  return {
    async load() {
      if (!safeStorage.isEncryptionAvailable()) return memory
      if (!existsSync(path)) return null
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as { v: number; data: string }
        return JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, 'base64'))) as KiroCredentials
      } catch {
        return null
      }
    },
    async save(creds) {
      memory = creds
      if (!safeStorage.isEncryptionAvailable()) return
      if (!creds) {
        rmSync(path, { force: true })
        return
      }
      const data = safeStorage.encryptString(JSON.stringify(creds)).toString('base64')
      writeFileSync(path, JSON.stringify({ v: 1, data }), { encoding: 'utf8', mode: 0o600 })
    }
  }
}

let service: KiroService | null = null

export function getKiroService(): KiroService {
  if (!service) {
    service = createKiroService({
      store: secureStore(),
      sqlite: (p) => new Database(p, { readonly: true, fileMustExist: true, timeout: 2000 }) as never,
      version: app.getVersion(),
      emit: (requestId, event) => {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) win.webContents.send('kiro:event', { requestId, event })
      },
      onLoginDone: (result) => {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) win.webContents.send('kiro:loginDone', result)
      },
      openUrl: (url) => {
        if (/^https:\/\//.test(url)) void shell.openExternal(url)
      }
    })
  }
  return service
}

export function registerKiroIpc(): void {
  const svc = getKiroService()
  handleTrusted('kiro:status', () => svc.status())
  handleTrusted('kiro:startLogin', (_e, opts: unknown) => svc.startLogin(opts))
  handleTrusted('kiro:cancelLogin', async () => svc.cancelLogin())
  handleTrusted('kiro:signOut', () => svc.signOut())
  handleTrusted('kiro:setApiKey', (_e, key: unknown, region: unknown) => svc.setApiKey(key, region))
  handleTrusted('kiro:import', (_e, source: unknown) => svc.importLogin(source))
  handleTrusted('kiro:models', () => svc.models())
  handleTrusted('kiro:usage', () => svc.usage())
  handleTrusted('kiro:chatStart', async (_e, requestId: unknown, body: unknown) => svc.chatStart(requestId, body))
  handleTrusted('kiro:chatAbort', async (_e, requestId: unknown) => svc.chatAbort(requestId))
}

export function disposeKiro(): void {
  service?.dispose()
}
