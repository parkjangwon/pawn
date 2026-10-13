import { createServer, type Server } from 'node:http'
import net, { createServer as createNetServer, type AddressInfo, type Server as NetServer, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectCheck, probeUrl } from '../netProbe'

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

function listenNet(server: NetServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function closeNet(server: NetServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

describe('connectCheck', () => {
  const stray: Socket[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const socket of stray) socket.destroy()
    stray.length = 0
  })

  it('resolves once TCP connects and destroys the socket', async () => {
    const server = createNetServer()
    let closed!: () => void
    const closedP = new Promise<void>((resolve) => { closed = resolve })
    server.on('connection', (sock) => sock.once('close', () => closed()))
    const port = await listenNet(server)
    try {
      const result = await connectCheck(`http://127.0.0.1:${port}/v1`, 2_000)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.ms).toBeGreaterThanOrEqual(0)
      await closedP
    } finally {
      await closeNet(server)
    }
  })

  it('returns the socket error code when connect fails', async () => {
    const result = await connectCheck('http://127.0.0.1:1/', 2_000)
    expect(result).toEqual({ ok: false, code: 'ECONNREFUSED' })
  })

  it('returns UND_ERR_CONNECT_TIMEOUT when the handshake exceeds timeoutMs', async () => {
    vi.spyOn(net, 'connect').mockImplementation((() => {
      const socket = new net.Socket()
      stray.push(socket)
      return socket
    }) as typeof net.connect)
    const result = await connectCheck('http://10.255.255.1/', 30)
    expect(result).toEqual({ ok: false, code: 'UND_ERR_CONNECT_TIMEOUT' })
    expect(stray[0]?.destroyed).toBe(true)
  })

  it('rejects a non-http URL without opening a socket', async () => {
    const connect = vi.spyOn(net, 'connect')
    expect(await connectCheck('ftp://127.0.0.1/', 1_000)).toEqual({ ok: false, code: 'EINVALIDURL' })
    expect(await connectCheck('not a url', 1_000)).toEqual({ ok: false, code: 'EINVALIDURL' })
    expect(connect).not.toHaveBeenCalled()
  })
})
