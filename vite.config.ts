import * as db from './src/main/db'
import { loadConfig, saveConfig } from './src/main/config'
import { resolve, join } from 'path'
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { WebSocketServer } from 'ws'

// Dev-only proxy to bypass CORS when testing in browser (not Electron)
function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy',
    configureServer(server) {
      // Terminal WebSocket for PTY
      const wss = new WebSocketServer({ noServer: true })
      server.httpServer?.on('upgrade', (request, socket, head) => {
        if (request.url === '/api/terminal') {
          wss.handleUpgrade(request, socket, head, (ws) => {
            try {
              const nodePty = require(require('path').join(process.cwd(), 'node_modules', 'node-pty'))
              const shell = process.env.SHELL || 'zsh'
              const term = nodePty.spawn(shell, [], {
                name: 'xterm-256color', cols: 80, rows: 24,
                cwd: process.cwd(),
                env: { ...process.env, TERM: 'xterm-256color' }
              })
              ws.on('message', (data) => {
                try { const m = JSON.parse(data.toString()); if (m.type === 'input') term.write(m.data); else if (m.type === 'resize') term.resize(m.cols, m.rows) } catch {}
              })
              term.onData((d) => { try { ws.send(JSON.stringify({ type: 'data', data: d })) } catch {} })
              term.onExit(() => { try { ws.close() } catch {} })
              ws.on('close', () => { try { term.kill() } catch {} })
            } catch (e) {
              try { ws.send(JSON.stringify({ type: 'data', data: '\r\nFailed to start shell: ' + String(e) + '\r\n' })) } catch {}
            }
          })
        }
      })

      
      // Config API for browser mode — backs provider/model/settings persistence.
      // Missing entirely before this: window.api.config.load()/save() called
      // '/api/config/load' and '/api/config/save', but no middleware answered
      // them, so every request 404'd and dev:web silently ran with providers
      // and models that never persisted across a reload.
      server.middlewares.use('/api/config', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        const action = (req.url || '').replace(/^\//, '').split('?')[0]
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          const send = (obj: unknown): void => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          try {
            switch (action) {
              case 'load':
                send(loadConfig())
                break
              case 'save': {
                const partial = body ? JSON.parse(body) : {}
                saveConfig(partial)
                send({ ok: true })
                break
              }
              default:
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Unknown config action' }))
            }
          } catch (err) {
            send({ error: String(err) })
          }
        })
      })

      // Database API for browser mode — backs sessions, messages, and project lists
      server.middlewares.use('/api/db', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        const action = (req.url || '').replace(/^\//, '').split('?')[0]
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          let data: Record<string, unknown> = {}
          try { data = body ? JSON.parse(body) : {} } catch { /* empty body */ }
          const send = (obj: unknown): void => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          try {
            switch (action) {
              case 'loadAll':
                send(db.loadFullState())
                break
              case 'addProject':
                db.addProject(data.id as string, data.name as string, data.path as string)
                send({ ok: true })
                break
              case 'updateProjectName':
                db.updateProjectName(data.id as string, data.name as string)
                send({ ok: true })
                break
              case 'updateProjectPaths':
                db.updateProjectPaths(data.id as string, data.paths as string)
                send({ ok: true })
                break
              case 'removeProject':
                db.removeProject(data.id as string)
                send({ ok: true })
                break
              case 'addSession':
                db.addSession(data.id as string, data.projectId as string, data.title as string, (data.path as string) || '')
                send({ ok: true })
                break
              case 'updateSessionTitle':
                db.updateSessionTitle(data.id as string, data.title as string)
                send({ ok: true })
                break
              case 'updateSessionPath':
                db.updateSessionPath(data.id as string, data.path as string)
                send({ ok: true })
                break
              case 'removeSession':
                db.removeSession(data.id as string)
                send({ ok: true })
                break
              case 'addMessage':
                db.addMessage(data.id as string, data.sessionId as string, data.role as string, data.content as string)
                send({ ok: true })
                break
              case 'updateMessageContent':
                db.updateMessageContent(data.id as string, data.content as string)
                send({ ok: true })
                break
              case 'getMessages':
                send(db.getMessagesBySession(data.sessionId as string) || [])
                break
              case 'deleteMessage':
                db.deleteMessage(data.id as string)
                send({ ok: true })
                break
              case 'clearMessages':
                db.clearMessages(data.sessionId as string)
                send({ ok: true })
                break
              case 'getTranscript':
                send(db.getTranscript(data.sessionId as string))
                break
              case 'saveTranscript':
                db.saveTranscript(data.sessionId as string, data.json as string)
                send({ ok: true })
                break
              case 'clearTranscript':
                db.clearTranscript(data.sessionId as string)
                send({ ok: true })
                break
              case 'addUsage':
                db.addUsage(data as unknown as Parameters<typeof db.addUsage>[0])
                send({ ok: true })
                break
              case 'getUsageBySession':
                send(db.getUsageBySession(data.sessionId as string))
                break
              case 'getUsageSummary':
                send(db.getUsageSummary(Number(data.since) || 0))
                break
              default:
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Unknown db action' }))
            }
          } catch (err) {
            send({ error: String(err) })
          }
        })
      })

      // Filesystem API for browser (dev:web) mode — backs FileTree, skills, and @ mentions
      server.middlewares.use('/api/fs', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return }
        const action = (req.url || '').replace(/^\//, '').split('?')[0]
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          let data: Record<string, unknown> = {}
          try { data = body ? JSON.parse(body) : {} } catch { /* empty body */ }
          const send = (obj: unknown): void => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          try {
            const p = data.path as string
            switch (action) {
              case 'readFile':
                send(readFileSync(p, 'utf8'))
                break
              case 'writeFile':
                writeFileSync(p, data.content as string, 'utf8')
                send({ ok: true })
                break
              case 'listDir': {
                const entries = readdirSync(p, { withFileTypes: true })
                send(entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory(), path: join(p, e.name) })))
                break
              }
              case 'stat': {
                const s = statSync(p)
                send({ size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtimeMs })
                break
              }
              case 'mkdir':
                mkdirSync(p, { recursive: true })
                send({ ok: true })
                break
              case 'delete':
                unlinkSync(p)
                send({ ok: true })
                break
              case 'exists':
                send(existsSync(p))
                break
              case 'walk': {
                const IGNORE = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.next', 'coverage', '.turbo', '.cache'])
                const results: Array<{ name: string; path: string; isDirectory: boolean }> = []
                const MAX = 3000
                const walk = (dir: string, depth: number): void => {
                  if (depth > 6 || results.length >= MAX) return
                  let entries
                  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
                  for (const e of entries) {
                    if (results.length >= MAX) return
                    if (e.name.startsWith('.')) continue
                    if (IGNORE.has(e.name)) continue
                    const full = join(dir, e.name)
                    if (e.isDirectory()) walk(full, depth + 1)
                    else results.push({ name: e.name, path: full, isDirectory: false })
                  }
                }
                walk(p, 0)
                send(results)
                break
              }
              default:
                res.statusCode = 404
                res.end(JSON.stringify({ error: 'Unknown action' }))
            }
          } catch (err) {
            send({ error: String(err) })
          }
        })
      })

      // Browser proxy: strip X-Frame-Options to allow iframe embedding
      server.middlewares.use('/api/browser/proxy', async (req, res) => {
        const raw = new URL(req.url || '', 'http://x').searchParams.get('url')
        if (!raw) { res.statusCode = 400; res.end('Missing url'); return }
        try {
          const resp = await fetch(raw, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
            redirect: 'follow'
          })
          if (!resp.ok) { res.statusCode = resp.status; res.end('Fetch failed: ' + resp.status); return }
          const ct = resp.headers.get('content-type') || 'text/html'
          res.setHeader('Content-Type', ct)
          // Strip iframe-blocking headers
          for (const [k, v] of resp.headers.entries()) {
            const lower = k.toLowerCase()
            if (lower !== 'x-frame-options' && lower !== 'content-security-policy' && lower !== 'referrer-policy')
              res.setHeader(k, v)
          }
          res.setHeader('Content-Security-Policy', 'frame-ancestors *')
          if (resp.body) {
            const reader = resp.body.getReader()
            const pump = async () => { while (true) { const { done, value } = await reader.read(); if (done) { res.end(); return } res.write(Buffer.from(value)) } }
            await pump()
          } else {
            const text = await resp.text(); res.end(text)
          }
        } catch (err) {
          res.statusCode = 502; res.end('Proxy error: ' + String(err))
        }
      })

      server.middlewares.use('/api/proxy', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const { url, headers, body: reqBody } = JSON.parse(body)
            const response = await fetch(url, {
              method: 'POST',
              headers,
              body: reqBody
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
                  res.write(value)
                }
              }
              await pump()
            } else {
              res.end()
            }
          } catch (err) {
            res.statusCode = 502
            res.end(JSON.stringify({ error: String(err) }))
          }
        })
      })
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: 'all'
  },
  plugins: [react(), apiProxyPlugin()]
})
