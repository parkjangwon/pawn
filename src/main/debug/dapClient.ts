import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'

/**
 * A generic Debug Adapter Protocol (DAP) client.
 *
 * Speaks Content-Length framed JSON over any pair of duplex/stdio streams or a
 * TCP socket. It correlates requests with responses via the `seq`/`request_seq`
 * fields, surfaces adapter events through an EventEmitter, and answers reverse
 * requests (requests the adapter sends to the client) with a graceful failure.
 */

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  [key: string]: unknown
}

interface PendingRequest {
  resolve: (body: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  command: string
}

const CRLF = '\r\n'

export class DapClient extends EventEmitter {
  private readonly input: Readable
  private readonly output: Writable
  private seq = 1
  private buffer = Buffer.alloc(0)
  private contentLength = -1
  private readonly pending = new Map<number, PendingRequest>()
  private disposed = false
  private readonly onDataBound: (chunk: Buffer) => void

  constructor(input: Readable, output: Writable) {
    super()
    this.input = input
    this.output = output
    this.onDataBound = (chunk: Buffer): void => this.onData(chunk)
    this.input.on('data', this.onDataBound)
    this.input.on('error', (err: Error) => this.emit('error', err))
    this.input.on('close', () => this.handleClose())
    this.input.on('end', () => this.handleClose())
  }

  /** Send a DAP request and resolve with the response body (or reject on failure). */
  request<T = unknown>(command: string, args?: unknown, timeoutMs = 15000): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error(`DAP client disposed; cannot send "${command}"`))
    }
    const seq = this.seq++
    const message: DapMessage = { seq, type: 'request', command }
    if (args !== undefined) {
      ;(message as Record<string, unknown>).arguments = args
    }
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(seq)
          reject(new Error(`DAP request "${command}" timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        if (typeof timer.unref === 'function') timer.unref()
      }
      this.pending.set(seq, {
        resolve: resolve as (body: unknown) => void,
        reject,
        timer,
        command
      })
      try {
        this.writeMessage(message)
      } catch (err) {
        this.pending.delete(seq)
        if (timer) clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  private writeMessage(message: DapMessage): void {
    const json = JSON.stringify(message)
    const body = Buffer.from(json, 'utf8')
    const header = Buffer.from(`Content-Length: ${body.length}${CRLF}${CRLF}`, 'ascii')
    this.output.write(Buffer.concat([header, body]))
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // Loop: a single chunk may contain a partial message, one message, or many.
    for (;;) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf(`${CRLF}${CRLF}`, 0, 'ascii')
        if (headerEnd === -1) return
        const header = this.buffer.toString('ascii', 0, headerEnd)
        const match = /Content-Length:\s*(\d+)/i.exec(header)
        if (!match) {
          // Corrupt header; drop it and continue.
          this.buffer = this.buffer.subarray(headerEnd + 4)
          continue
        }
        this.contentLength = parseInt(match[1], 10)
        this.buffer = this.buffer.subarray(headerEnd + 4)
      }
      if (this.buffer.length < this.contentLength) return
      const body = this.buffer.subarray(0, this.contentLength)
      this.buffer = this.buffer.subarray(this.contentLength)
      this.contentLength = -1
      let parsed: DapMessage | null = null
      try {
        parsed = JSON.parse(body.toString('utf8')) as DapMessage
      } catch (err) {
        this.emit('error', new Error(`DAP: failed to parse message: ${String(err)}`))
        continue
      }
      if (parsed) this.dispatch(parsed)
    }
  }

  private dispatch(message: DapMessage): void {
    if (message.type === 'response') {
      const requestSeq = message.request_seq as number
      const pending = this.pending.get(requestSeq)
      if (!pending) return
      this.pending.delete(requestSeq)
      if (pending.timer) clearTimeout(pending.timer)
      if (message.success === true) {
        pending.resolve(message.body)
      } else {
        const msg =
          (typeof message.message === 'string' && message.message) ||
          `DAP request "${pending.command}" failed`
        pending.reject(new Error(msg))
      }
      return
    }
    if (message.type === 'event') {
      this.emit('event', message)
      this.emit(`event:${message.event as string}`, message.body)
      return
    }
    if (message.type === 'request') {
      // Reverse request: answer politely with a failure so adapters proceed.
      this.handleReverseRequest(message)
    }
  }

  private handleReverseRequest(message: DapMessage): void {
    const command = message.command as string
    let body: unknown
    let responseMessage: string | undefined
    if (command === 'runInTerminal') {
      responseMessage = 'not supported'
    } else if (command === 'startDebugging') {
      responseMessage = 'startDebugging not supported'
    } else {
      responseMessage = `reverse request "${command}" not supported`
    }
    const response: DapMessage = {
      seq: this.seq++,
      type: 'response',
      request_seq: message.seq,
      success: false,
      command,
      message: responseMessage
    }
    if (body !== undefined) (response as Record<string, unknown>).body = body
    try {
      this.writeMessage(response)
    } catch {
      // stream may already be gone; ignore.
    }
    this.emit('reverseRequest', message)
  }

  private handleClose(): void {
    if (this.disposed) return
    this.rejectAllPending(new Error('DAP connection closed'))
    this.emit('close')
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of Array.from(this.pending.entries())) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  /** Reject all pending requests and stop listening. */
  dispose(err?: Error): void {
    if (this.disposed) return
    this.disposed = true
    this.rejectAllPending(err ?? new Error('DAP client disposed'))
    try {
      this.input.off('data', this.onDataBound)
    } catch {
      // ignore
    }
    this.emit('close')
  }
}
