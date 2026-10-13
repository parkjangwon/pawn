import { createServer, type Server } from 'node:http'
import net, { createServer as createNetServer, type AddressInfo, type Server as NetServer, type Socket } from 'node:net'
import tls from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectCheck, envProxyFor, probeUrl } from '../netProbe'

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
      const result = await connectCheck(`http://127.0.0.1:${port}/v1`, 2_000, { env: {} })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.ms).toBeGreaterThanOrEqual(0)
      await closedP
    } finally {
      await closeNet(server)
    }
  })

  it('returns the socket error code when connect fails', async () => {
    const result = await connectCheck('http://127.0.0.1:1/', 2_000, { env: {} })
    expect(result).toEqual({ ok: false, code: 'ECONNREFUSED' })
  })

  it('returns UND_ERR_CONNECT_TIMEOUT when the handshake exceeds timeoutMs', async () => {
    vi.spyOn(net, 'connect').mockImplementation((() => {
      const socket = new net.Socket()
      stray.push(socket)
      return socket
    }) as typeof net.connect)
    const result = await connectCheck('http://10.255.255.1/', 30, { env: {} })
    expect(result).toEqual({ ok: false, code: 'UND_ERR_CONNECT_TIMEOUT' })
    expect(stray[0]?.destroyed).toBe(true)
  })

  it('rejects a non-http URL without opening a socket', async () => {
    const connect = vi.spyOn(net, 'connect')
    expect(await connectCheck('ftp://127.0.0.1/', 1_000, { env: { HTTP_PROXY: 'http://proxy.local:8080' } })).toEqual({ ok: false, code: 'EINVALIDURL' })
    expect(await connectCheck('not a url', 1_000)).toEqual({ ok: false, code: 'EINVALIDURL' })
    expect(connect).not.toHaveBeenCalled()
  })

  it('skips when resolveProxy returns a proxy and does not open a socket', async () => {
    const connect = vi.spyOn(net, 'connect')
    const secure = vi.spyOn(tls, 'connect')
    const started = Date.now()
    const skip = { ok: true, skipped: true, reason: 'proxy', ms: 0 }
    const result = await connectCheck('http://10.255.255.1/', 2_000, {
      env: {},
      resolveProxy: async () => 'PROXY proxy.local:8080'
    })
    expect(Date.now() - started).toBeLessThan(500)
    expect(result).toEqual(skip)
    expect(await connectCheck('https://10.255.255.1/v1', 2_000, {
      env: {},
      resolveProxy: async () => 'PROXY proxy.local:8080; DIRECT'
    })).toEqual(skip)
    expect(connect).not.toHaveBeenCalled()
    expect(secure).not.toHaveBeenCalled()
  })

  it('skips for HTTPS_PROXY and HTTP_PROXY, lowercase first', async () => {
    const connect = vi.spyOn(net, 'connect')
    const secure = vi.spyOn(tls, 'connect')
    const cases: Array<[string, NodeJS.ProcessEnv]> = [
      ['https://10.255.255.1/v1', { HTTPS_PROXY: 'http://proxy.local:8080' }],
      ['https://10.255.255.1/v1', { https_proxy: 'http://lower:8080', HTTPS_PROXY: 'http://upper:8080' }],
      ['http://10.255.255.1/v1', { HTTP_PROXY: 'http://proxy.local:8080' }],
      ['http://10.255.255.1/v1', { http_proxy: 'http://lower:8080', HTTP_PROXY: 'http://upper:8080' }]
    ]
    for (const [url, env] of cases) {
      expect(await connectCheck(url, 2_000, { env })).toEqual({ ok: true, skipped: true, reason: 'proxy', ms: 0 })
    }
    expect(connect).not.toHaveBeenCalled()
    expect(secure).not.toHaveBeenCalled()
  })

  it('dials when NO_PROXY matches the host', async () => {
    const server = createNetServer()
    const port = await listenNet(server)
    try {
      const result = await connectCheck(`http://127.0.0.1:${port}/v1`, 2_000, {
        env: { HTTP_PROXY: 'http://proxy.local:8080', NO_PROXY: 'localhost, 127.0.0.1' }
      })
      expect(result.ok).toBe(true)
      expect(result).not.toHaveProperty('skipped', true)
    } finally {
      await closeNet(server)
    }
  })

  it('dials when resolveProxy is DIRECT, empty, or throws', async () => {
    const server = createNetServer()
    const port = await listenNet(server)
    const url = `http://127.0.0.1:${port}/v1`
    const resolvers = [
      async () => 'DIRECT',
      async () => 'direct',
      async () => '',
      async () => {
        throw new Error('no session')
      }
    ]
    try {
      for (const resolveProxy of resolvers) {
        const result = await connectCheck(url, 2_000, { env: {}, resolveProxy })
        expect(result.ok).toBe(true)
        expect(result).not.toHaveProperty('skipped', true)
      }
    } finally {
      await closeNet(server)
    }
  })
})

describe('envProxyFor', () => {
  it('exempts NO_PROXY host, subdomain, star, and matching port', () => {
    const proxy = { HTTPS_PROXY: 'http://p:1', HTTP_PROXY: 'http://p:1' }
    expect(envProxyFor('https://api.example.com/v1', { https_proxy: 'http://lower:1', HTTPS_PROXY: 'http://upper:1' })).toBe('http://lower:1')
    expect(envProxyFor('https://api.example.com/v1', { ...proxy, NO_PROXY: '.example.com' })).toBeNull()
    expect(envProxyFor('https://api.example.com/v1', { ...proxy, no_proxy: 'example.com other.test' })).toBeNull()
    expect(envProxyFor('https://api.example.com/v1', { ...proxy, NO_PROXY: '*' })).toBeNull()
    expect(envProxyFor('https://api.example.com/v1', { ...proxy, NO_PROXY: 'example.com:443' })).toBeNull()
    expect(envProxyFor('https://api.example.com:8443/v1', { ...proxy, NO_PROXY: 'example.com:443' })).toBe('http://p:1')
    expect(envProxyFor('http://api.example.com/v1', { HTTPS_PROXY: 'http://p:1' })).toBeNull()
    expect(envProxyFor('https://other.test/v1', { HTTP_PROXY: 'http://p:1' })).toBeNull()
  })
})
