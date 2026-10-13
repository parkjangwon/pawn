import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { probeUrl } from '../netProbe'

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

describe('probeUrl', () => {
  it('reports ECONNREFUSED once the listener is gone', async () => {
    const server = createServer()
    const port = await listen(server)
    await close(server)
    const result = await probeUrl(`http://127.0.0.1:${port}/`)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ECONNREFUSED')
  })

  it('reports EBADPORT for an unsafe port', async () => {
    const result = await probeUrl('http://127.0.0.1:6000/')
    expect(result.ok).toBe(false)
    expect(result.code).toBe('EBADPORT')
    expect(result.message?.toLowerCase()).toContain('bad port')
  })

  it('rejects a non-http URL', async () => {
    expect(await probeUrl('ftp://127.0.0.1/')).toEqual({ ok: false, code: 'EINVALIDURL' })
    expect(await probeUrl('not a url')).toEqual({ ok: false, code: 'EINVALIDURL' })
  })

  it('returns the status from a local server', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(204)
      res.end()
    })
    const port = await listen(server)
    try {
      expect(await probeUrl(`http://127.0.0.1:${port}/x`)).toEqual({ ok: true, status: 204 })
    } finally {
      await close(server)
    }
  })
})
