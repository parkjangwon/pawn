import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
