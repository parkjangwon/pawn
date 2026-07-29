import { resolve, join } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { loadConfig, saveConfig } from './src/main/config'
import * as db from './src/main/db'

// Dev-only proxy to bypass CORS when testing in browser (not Electron)
function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk })
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
              const config = JSON.parse(body || '{}')
              saveConfig(config)
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
              case 'removeProject': db.removeProject(data.id); res.end('{"ok":true}'); break
              case 'addSession': db.addSession(data.id, data.projectId, data.title, data.path || ''); res.end('{"ok":true}'); break
              case 'updateSessionTitle': db.updateSessionTitle(data.id, data.title); res.end('{"ok":true}'); break
              case 'updateSessionPath': db.updateSessionPath(data.id, data.path); res.end('{"ok":true}'); break
              case 'removeSession': db.removeSession(data.id); res.end('{"ok":true}'); break
              case 'addMessage': db.addMessage(data.id, data.sessionId, data.role, data.content); res.end('{"ok":true}'); break
              case 'updateMessageContent': db.updateMessageContent(data.id, data.content); res.end('{"ok":true}'); break
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true
    },
    plugins: [react(), apiProxyPlugin()]
  }
})
