import { resolve, join } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { loadConfig, saveConfig } from './src/main/config'
import * as db from './src/main/db'

/** Build-time OAuth clients: .env / process.env / CI secrets → baked into main. */
function pawnOAuthDefine(mode: string): Record<string, string> {
  const env = loadEnv(mode, process.cwd(), '')
  const pick = (key: string): string =>
    (process.env[key] || env[key] || '').trim()
  const oauth = {
    googleClientId: pick('PAWN_GOOGLE_CLIENT_ID'),
    googleClientSecret: pick('PAWN_GOOGLE_CLIENT_SECRET'),
    githubClientId: pick('PAWN_GITHUB_CLIENT_ID'),
    githubClientSecret: pick('PAWN_GITHUB_CLIENT_SECRET')
  }
  return {
    __PAWN_OAUTH__: JSON.stringify(oauth)
  }
}

/**
 * The Electron dev server hosts file/db/config APIs and an LLM proxy with no
 * authentication. Bind to loopback and reject requests from any origin other
 * than the Vite page itself so a random website cannot reach them.
 */
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  return ALLOWED_ORIGINS.has(origin)
}

// Dev-only proxy to bypass CORS when testing in browser (not Electron)
function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        if (!isAllowedOrigin(req.headers.origin)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk })
        req.on('end', async () => {
          try {
            const { url, headers, body: reqBody, method: reqMethod } = JSON.parse(body)
            const method = typeof reqMethod === 'string' && reqMethod ? reqMethod.toUpperCase() : 'POST'
            const response = await fetch(url, {
              method,
              headers,
              body: method === 'GET' || method === 'HEAD' ? undefined : reqBody
            })

            res.statusCode = response.status
            res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain')
            res.setHeader('Cache-Control', 'no-cache')

            if (response.body) {
              const reader = response.body.getReader()
              const pump = async (): Promise<void> => {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) { res.end(); return }
                  res.write(Buffer.from(value))
                }
              }
              await pump()
            } else {
              const text = await response.text()
              res.end(text)
            }
          } catch (err) {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(err) }))
          }
        })
      })

      // File system API for browser mode
      server.middlewares.use('/api/fs', async (req, res) => {
        if (!isAllowedOrigin(req.headers.origin)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        res.setHeader('Content-Type', 'application/json')
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk })
        req.on('end', () => {
          try {
            const url = new URL(req.url || '', 'http://localhost')
            const action = url.pathname.replace(/^\//, '')
            const { path, content } = JSON.parse(body || '{}')

            switch (action) {
              case 'listDir': {
                const entries = readdirSync(path, { withFileTypes: true })
                const basePath = path.endsWith('/') ? path : path + '/'
                res.end(JSON.stringify(entries.map((e) => ({
                  name: e.name,
                  isDirectory: e.isDirectory(),
                  path: basePath + e.name
                }))))
                break
              }
              case 'readFile': {
                const data = readFileSync(path, 'utf-8')
                res.end(JSON.stringify(data))
                break
              }
              case 'writeFile': {
                writeFileSync(path, content, 'utf-8')
                res.end(JSON.stringify({ ok: true }))
                break
              }
              case 'stat': {
                const s = statSync(path)
                res.end(JSON.stringify({ size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtimeMs }))
                break
              }
              case 'exists': {
                res.end(JSON.stringify(existsSync(path)))
                break
              }
              case 'mkdir': {
                mkdirSync(path, { recursive: true })
                res.end(JSON.stringify({ ok: true }))
                break
              }
              case 'delete': {
                unlinkSync(path)
                res.end(JSON.stringify({ ok: true }))
                break
              }
              default:
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Unknown action' }))
            }
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err) }))
          }
        })
      })

      // Config API (TOML)
      server.middlewares.use('/api/config', async (req, res) => {
        if (!isAllowedOrigin(req.headers.origin)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        res.setHeader('Content-Type', 'application/json')
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk })
        req.on('end', () => {
          try {
            const url = new URL(req.url || '', 'http://localhost')
            const action = url.pathname.replace(/^\//, '')
            if (action === 'load') {
              res.end(JSON.stringify(loadConfig()))
            } else if (action === 'save') {
              const partial = JSON.parse(body || '{}')
              // Merge with existing config
              const existing = loadConfig()
              const merged = { ...existing, ...partial, settings: { ...existing.settings, ...partial.settings } }
              saveConfig(merged)
              res.end(JSON.stringify({ ok: true }))
            } else {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Unknown action' }))
            }
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err) }))
          }
        })
      })

      // Database API (SQLite)
      server.middlewares.use('/api/db', async (req, res) => {
        if (!isAllowedOrigin(req.headers.origin)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        res.setHeader('Content-Type', 'application/json')
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk })
        req.on('end', () => {
          try {
            const url = new URL(req.url || '', 'http://localhost')
            const action = url.pathname.replace(/^\//, '')
            const data = JSON.parse(body || '{}')
            switch (action) {
              case 'loadAll': res.end(JSON.stringify(db.loadFullState())); break
              case 'addProject': db.addProject(data.id, data.name, data.path); res.end('{"ok":true}'); break
              case 'updateProjectName': db.updateProjectName(data.id, data.name); res.end('{"ok":true}'); break
              case 'updateProjectPaths': db.updateProjectPaths(data.id, data.paths); res.end('{"ok":true}'); break
              case 'removeProject': db.removeProject(data.id); res.end('{"ok":true}'); break
              case 'addSession': db.addSession(data.id, data.projectId, data.title, data.path || ''); res.end('{"ok":true}'); break
              case 'updateSessionTitle': db.updateSessionTitle(data.id, data.title); res.end('{"ok":true}'); break
              case 'updateSessionPath': db.updateSessionPath(data.id, data.path); res.end('{"ok":true}'); break
              case 'removeSession': db.removeSession(data.id); res.end('{"ok":true}'); break
              case 'addMessage': db.addMessage(data.id, data.sessionId, data.role, data.content); res.end('{"ok":true}'); break
              case 'updateMessageContent': db.updateMessageContent(data.id, data.content); res.end('{"ok":true}'); break
              case 'getMessages': res.end(JSON.stringify(db.getMessagesBySession(data.sessionId) || [])); break
              case 'searchSessions': res.end(JSON.stringify(db.searchSessions(data.query || '') || [])); break
              case 'deleteMessage': db.deleteMessage(data.id); res.end('{"ok":true}'); break
              case 'clearMessages': db.clearMessages(data.sessionId); res.end('{"ok":true}'); break
              case 'getTranscript': res.end(JSON.stringify(db.getTranscript(data.sessionId))); break
              case 'saveTranscript': db.saveTranscript(data.sessionId, data.json); res.end('{"ok":true}'); break
              case 'clearTranscript': db.clearTranscript(data.sessionId); res.end('{"ok":true}'); break
              case 'addUsage': db.addUsage(data); res.end('{"ok":true}'); break
              case 'getUsageBySession': res.end(JSON.stringify(db.getUsageBySession(data.sessionId))); break
              case 'getUsageSummary': res.end(JSON.stringify(db.getUsageSummary(Number(data.since) || 0))); break
              default: res.statusCode = 404; res.end('{"error":"Unknown action"}')
            }
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err) }))
          }
        })
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  const oauthDefine = pawnOAuthDefine(mode)
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: oauthDefine
    },
    preload: {
      // Sandboxed preloads are loaded as CommonJS by the renderer and cannot
      // require external packages, so @electron-toolkit/preload must be bundled
      // in and the output emitted as CJS (see window.ts sandbox: true).
      plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })],
      build: {
        rollupOptions: {
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs'
          }
        }
      }
    },
    renderer: {
      resolve: {
        alias: {
          '@': resolve('src/renderer/src')
        }
      },
      server: {
        host: '127.0.0.1',
        allowedHosts: ['localhost', '127.0.0.1']
      },
      plugins: [react(), apiProxyPlugin()]
    }
  }
})
