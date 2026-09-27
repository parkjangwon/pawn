/**
 * Kiro provider service (pure Node): auth + client behind a small,
 * transport-agnostic surface used by Electron IPC and the headless runner.
 * Streaming chat results are pushed through `emit(requestId, event)`.
 */

import { KiroAuth, KiroAuthError, type KiroSecureStore, type KiroStatus, type SqliteOpen } from './auth'
import { KiroApiError, KiroClient, type KiroEvent } from './client'

export type KiroStreamEvent = KiroEvent | { type: 'done' }

export interface KiroServiceOptions {
  store: KiroSecureStore
  sqlite?: SqliteOpen | null
  fetch?: typeof fetch
  version?: string
  home?: string
  emit: (requestId: string, event: KiroStreamEvent) => void
  onLoginDone?: (result: { ok: boolean; status?: KiroStatus; error?: string }) => void
  openUrl?: (url: string) => void
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string }

function fail(err: unknown): { ok: false; error: string; code?: string } {
  if (err instanceof KiroAuthError) return { ok: false, error: err.message, code: err.code }
  if (err instanceof KiroApiError) return { ok: false, error: err.message, code: err.code }
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,120}$/

export function createKiroService(opts: KiroServiceOptions) {
  const auth = new KiroAuth(opts.store, { fetch: opts.fetch, sqlite: opts.sqlite ?? null, home: opts.home })
  const client = new KiroClient(auth, { fetch: opts.fetch, version: opts.version })
  const active = new Map<string, AbortController>()

  return {
    auth,
    client,

    async status(): Promise<KiroStatus> {
      return auth.status()
    },

    async startLogin(raw: unknown): Promise<Result<{ verificationUri: string; verificationUriComplete: string; userCode: string; expiresIn: number }>> {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const mode = o.mode === 'idc' ? 'idc' : 'builder-id'
      try {
        const { device, done } = await auth.startDeviceLogin({
          mode,
          startUrl: typeof o.startUrl === 'string' ? o.startUrl : undefined,
          region: typeof o.region === 'string' ? o.region : undefined
        })
        done
          .then((status) => opts.onLoginDone?.({ ok: true, status }))
          .catch((err) => opts.onLoginDone?.({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        if (device.verificationUriComplete) opts.openUrl?.(device.verificationUriComplete)
        return { ok: true, ...device }
      } catch (err) {
        return fail(err)
      }
    },

    cancelLogin(): { ok: true } {
      auth.cancelDeviceLogin()
      return { ok: true }
    },

    async signOut(): Promise<{ ok: true }> {
      for (const c of Array.from(active.values())) c.abort()
      await auth.signOut()
      return { ok: true }
    },

    async setApiKey(key: unknown, region?: unknown): Promise<Result<{ status: KiroStatus }>> {
      if (typeof key !== 'string') return { ok: false, error: 'API key is required' }
      try {
        const status = await auth.setApiKey(key, typeof region === 'string' ? region : undefined)
        // Validate right away so a bad key fails here, not mid-chat.
        await client.listModels()
        return { ok: true, status }
      } catch (err) {
        await auth.signOut().catch(() => {})
        return fail(err)
      }
    },

    async importLogin(source: unknown): Promise<Result<{ status: KiroStatus }>> {
      const s = source === 'kiro-cli' || source === 'kiro-ide' ? source : 'auto'
      try {
        return { ok: true, status: await auth.importLogin(s) }
      } catch (err) {
        return fail(err)
      }
    },

    async models(): Promise<Result<{ models: Awaited<ReturnType<KiroClient['listModels']>> }>> {
      try {
        return { ok: true, models: await client.listModels() }
      } catch (err) {
        return fail(err)
      }
    },

    async usage(): Promise<Result<{ usage: Awaited<ReturnType<KiroClient['usage']>> }>> {
      try {
        return { ok: true, usage: await client.usage() }
      } catch (err) {
        return fail(err)
      }
    },

    /** Start a streaming chat; events arrive through `emit(requestId, …)`. */
    chatStart(requestId: unknown, body: unknown): { ok: boolean; error?: string } {
      if (typeof requestId !== 'string' || !SAFE_ID.test(requestId)) return { ok: false, error: 'Invalid request id' }
      if (!body || typeof body !== 'object' || !(body as Record<string, unknown>).conversationState) return { ok: false, error: 'Invalid request body' }
      if (JSON.stringify(body).length > 2_000_000) return { ok: false, error: 'Request too large for Kiro (over ~600 KB after trimming)' }
      const ctrl = new AbortController()
      active.get(requestId)?.abort()
      active.set(requestId, ctrl)
      void (async () => {
        try {
          for await (const ev of client.chat(body as Record<string, any>, ctrl.signal)) opts.emit(requestId, ev)
          opts.emit(requestId, { type: 'done' })
        } catch (err) {
          if (ctrl.signal.aborted) opts.emit(requestId, { type: 'error', message: 'Aborted', transient: false, code: 'aborted' })
          else if (err instanceof KiroApiError) opts.emit(requestId, { type: 'error', message: err.message, status: err.status, transient: err.transient, code: err.code })
          else if (err instanceof KiroAuthError) opts.emit(requestId, { type: 'error', message: err.message, transient: false, code: err.code })
          else opts.emit(requestId, { type: 'error', message: err instanceof Error ? err.message : String(err), transient: true })
        } finally {
          if (active.get(requestId) === ctrl) active.delete(requestId)
        }
      })()
      return { ok: true }
    },

    chatAbort(requestId: unknown): { ok: boolean } {
      if (typeof requestId !== 'string') return { ok: false }
      active.get(requestId)?.abort()
      active.delete(requestId)
      return { ok: true }
    },

    dispose(): void {
      for (const c of Array.from(active.values())) c.abort()
      active.clear()
      auth.cancelDeviceLogin()
    }
  }
}

export type KiroService = ReturnType<typeof createKiroService>
