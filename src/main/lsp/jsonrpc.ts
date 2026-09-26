/**
 * Minimal JSON-RPC 2.0 over stdio with LSP `Content-Length` framing.
 */

import type { ChildProcess } from 'child_process'

export type JsonRpcId = number | string

export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: JsonRpcId | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const HEADER_SEP = Buffer.from('\r\n\r\n')

export function encodeMessage(msg: JsonRpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/** Incremental decoder: feed raw stdout chunks, get whole messages back. */
export class MessageDecoder {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): JsonRpcMessage[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: JsonRpcMessage[] = []
    for (;;) {
      const headerEnd = this.buf.indexOf(HEADER_SEP)
      if (headerEnd < 0) break
      const header = this.buf.subarray(0, headerEnd).toString('ascii')
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) {
        // Garbage before a header (e.g. a server printing to stdout): skip it.
        this.buf = this.buf.subarray(headerEnd + HEADER_SEP.length)
        continue
      }
      const len = Number(m[1])
      const start = headerEnd + HEADER_SEP.length
      if (this.buf.length < start + len) break
      const body = this.buf.subarray(start, start + len).toString('utf8')
      this.buf = this.buf.subarray(start + len)
      try {
        out.push(JSON.parse(body) as JsonRpcMessage)
      } catch {
        /* drop malformed message */
      }
    }
    return out
  }
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message)
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Request/notify over a child process; answers server→client requests with `onRequest`. */
export class JsonRpcConnection {
  private nextId = 1
  private pending = new Map<JsonRpcId, Pending>()
  private decoder = new MessageDecoder()
  private closed = false
  onNotification: (method: string, params: unknown) => void = () => {}
  onRequest: (method: string, params: unknown) => unknown = () => null
  onClose: (reason: string) => void = () => {}

  constructor(private readonly proc: ChildProcess) {
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const msg of this.decoder.push(chunk)) this.handle(msg)
    })
    proc.on('exit', (code, signal) => this.close(`exited (${signal || code})`))
    proc.on('error', (err) => this.close(err.message))
    proc.stdin?.on('error', () => this.close('stdin closed'))
  }

  get isClosed(): boolean {
    return this.closed
  }

  private handle(msg: JsonRpcMessage): void {
    if (msg.method && msg.id !== undefined && msg.id !== null) {
      // Server → client request.
      let result: unknown = null
      try {
        result = this.onRequest(msg.method, msg.params) ?? null
      } catch {
        result = null
      }
      this.write({ jsonrpc: '2.0', id: msg.id, result })
      return
    }
    if (msg.method) {
      this.onNotification(msg.method, msg.params)
      return
    }
    if (msg.id === undefined || msg.id === null) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new RpcError(msg.error.message || 'LSP error', msg.error.code))
    else p.resolve(msg.result)
  }

  private write(msg: JsonRpcMessage): void {
    if (this.closed) return
    try {
      this.proc.stdin?.write(encodeMessage(msg))
    } catch {
      this.close('write failed')
    }
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError('connection closed'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RpcError(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  close(reason = 'closed'): void {
    if (this.closed) return
    this.closed = true
    for (const p of Array.from(this.pending.values())) {
      clearTimeout(p.timer)
      p.reject(new RpcError(`connection ${reason}`))
    }
    this.pending.clear()
    this.onClose(reason)
  }
}
