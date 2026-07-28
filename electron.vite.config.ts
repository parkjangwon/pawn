import { resolve, join } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'

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
