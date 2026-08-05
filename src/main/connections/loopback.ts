import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { URL } from 'url'

export interface LoopbackResult {
  code?: string
  error?: string
  errorDescription?: string
  port: number
}

/**
 * One-shot localhost HTTP server for OAuth redirect_uri.
 * Resolves on first /callback (or /) with ?code= / ?error=.
 */
export function waitForOAuthCallback(timeoutMs = 5 * 60_000): Promise<LoopbackResult> & { port: number; close: () => void } {
  let port = 0
  let serverClose: (() => void) | null = null

  const promise = new Promise<LoopbackResult>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const host = req.headers.host || `127.0.0.1:${port}`
        const u = new URL(req.url || '/', `http://${host}`)
        const code = u.searchParams.get('code') || undefined
        const error = u.searchParams.get('error') || undefined
        const errorDescription = u.searchParams.get('error_description') || undefined

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center">
          <h2>${error ? 'Connection failed' : 'Connected'}</h2>
          <p>${error ? (errorDescription || error) : 'You can close this window and return to Pawn.'}</p>
          <script>setTimeout(()=>window.close(),800)</script>
        </body></html>`)

        server.close()
        resolve({ code, error, errorDescription, port })
      } catch (e) {
        server.close()
        reject(e)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') port = addr.port
    })

    server.on('error', reject)

    const timer = setTimeout(() => {
      try { server.close() } catch { /* ignore */ }
      reject(new Error('OAuth timed out — no redirect received'))
    }, timeoutMs)

    const origResolve = resolve
    // clear timeout when done
    const wrap = (fn: typeof resolve): typeof resolve => (v) => {
      clearTimeout(timer)
      fn(v)
    }
    // re-bind — simpler: clear in server handler already before resolve
    void origResolve
    server.on('close', () => clearTimeout(timer))

    serverClose = () => {
      clearTimeout(timer)
      try { server.close() } catch { /* ignore */ }
    }
  }) as Promise<LoopbackResult> & { port: number; close: () => void }

  // port is assigned async; consumers should await a microtask or use redirect built after listen
  Object.defineProperty(promise, 'port', { get: () => port })
  promise.close = () => serverClose?.()

  return promise
}

/** Listen and return { port, wait } after the server is bound. */
export async function startOAuthLoopback(timeoutMs = 5 * 60_000): Promise<{
  port: number
  redirectUri: string
  wait: () => Promise<LoopbackResult>
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    let settled = false
    let waitSettled = false
    let boundPort = 0
    const server = createServer()
    let resultResolve: (v: LoopbackResult) => void
    let resultReject: (e: Error) => void
    const waitPromise = new Promise<LoopbackResult>((res, rej) => {
      resultResolve = res
      resultReject = rej
    })

    const finishWait = (fn: () => void): void => {
      if (waitSettled) return
      waitSettled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      try { server.close() } catch { /* ignore */ }
      finishWait(() => resultReject(new Error('OAuth timed out — complete sign-in in the browser')))
    }, timeoutMs)

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      try {
        const host = req.headers.host || '127.0.0.1'
        const u = new URL(req.url || '/', `http://${host}`)
        // Ignore favicon etc.
        if (u.pathname === '/favicon.ico') {
          res.writeHead(204)
          res.end()
          return
        }
        const code = u.searchParams.get('code') || undefined
        const error = u.searchParams.get('error') || undefined
        const errorDescription = u.searchParams.get('error_description') || undefined
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><html><body style="font-family:system-ui;padding:48px;text-align:center;background:#111;color:#eee">
          <h2 style="margin:0 0 12px">${error ? 'Sign-in failed' : 'Pawn connected'}</h2>
          <p style="opacity:.8">${error ? (errorDescription || error) : 'You can close this tab and return to Pawn.'}</p>
        </body></html>`)
        server.close()
        finishWait(() => resultResolve({ code, error, errorDescription, port: boundPort }))
      } catch (e) {
        server.close()
        finishWait(() => resultReject(e instanceof Error ? e : new Error(String(e))))
      }
    })

    server.on('error', (e) => {
      if (!settled) {
        settled = true
        reject(e)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind OAuth loopback'))
        return
      }
      settled = true
      boundPort = addr.port
      resolve({
        port: boundPort,
        redirectUri: `http://127.0.0.1:${boundPort}/callback`,
        wait: () => waitPromise,
        close: () => {
          try { server.close() } catch { /* ignore */ }
          finishWait(() => resultReject(new Error('Cancelled')))
        }
      })
    })
  })
}
