/**
 * AWS event-stream decoder (application/vnd.amazon.eventstream), as used by
 * the CodeWhisperer / Kiro GenerateAssistantResponse stream.
 *
 * Frame: [total length u32][headers length u32][prelude CRC32]
 *        [headers][payload][message CRC32]    (all big-endian)
 * Header: [name length u8][name][value type u8][value]; type 7 = string
 * (u16 length + UTF-8), other types are decoded or skipped by size.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface EventStreamMessage {
  headers: Record<string, string | number | boolean>
  payload: Uint8Array
}

const MAX_FRAME = 16 * 1024 * 1024

function readHeaders(view: DataView, bytes: Uint8Array, start: number, end: number): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  const dec = new TextDecoder()
  let p = start
  while (p < end) {
    const nameLen = bytes[p]
    p += 1
    const name = dec.decode(bytes.subarray(p, p + nameLen))
    p += nameLen
    const type = bytes[p]
    p += 1
    switch (type) {
      case 0:
        out[name] = true
        break
      case 1:
        out[name] = false
        break
      case 2:
        out[name] = view.getInt8(p)
        p += 1
        break
      case 3:
        out[name] = view.getInt16(p)
        p += 2
        break
      case 4:
        out[name] = view.getInt32(p)
        p += 4
        break
      case 5:
      case 8: // int64 / timestamp
        out[name] = Number(view.getBigInt64(p))
        p += 8
        break
      case 6:
      case 7: {
        const len = view.getUint16(p)
        p += 2
        out[name] = type === 7 ? dec.decode(bytes.subarray(p, p + len)) : `<${len} bytes>`
        p += len
        break
      }
      case 9: // uuid
        p += 16
        break
      default:
        throw new Error(`event-stream: unknown header type ${type}`)
    }
  }
  return out
}

/** Incremental decoder: push chunks, get complete messages. */
export class EventStreamDecoder {
  private buf: Uint8Array = new Uint8Array(0)

  push(chunk: Uint8Array): EventStreamMessage[] {
    if (chunk.length) {
      const next = new Uint8Array(this.buf.length + chunk.length)
      next.set(this.buf, 0)
      next.set(chunk, this.buf.length)
      this.buf = next
    }
    const out: EventStreamMessage[] = []
    for (;;) {
      if (this.buf.length < 12) break
      const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength)
      const total = view.getUint32(0)
      const headersLen = view.getUint32(4)
      if (total < 16 || total > MAX_FRAME || headersLen > total - 16) {
        throw new Error(`event-stream: bad frame (total ${total}, headers ${headersLen})`)
      }
      if (view.getUint32(8) !== crc32(this.buf, 0, 8)) throw new Error('event-stream: prelude CRC mismatch')
      if (this.buf.length < total) break
      if (view.getUint32(total - 4) !== crc32(this.buf, 0, total - 4)) throw new Error('event-stream: message CRC mismatch')
      const headers = readHeaders(view, this.buf, 12, 12 + headersLen)
      const payload = this.buf.slice(12 + headersLen, total - 4)
      out.push({ headers, payload })
      this.buf = this.buf.slice(total)
    }
    return out
  }

  get pending(): number {
    return this.buf.length
  }
}

/** Encode one message (tests / fakes). */
export function encodeEventStreamMessage(headers: Record<string, string>, payload: Uint8Array | string): Uint8Array {
  const enc = new TextEncoder()
  const body = typeof payload === 'string' ? enc.encode(payload) : payload
  const hParts: number[] = []
  for (const [k, v] of Object.entries(headers)) {
    const name = enc.encode(k)
    const val = enc.encode(v)
    hParts.push(name.length, ...Array.from(name), 7, (val.length >> 8) & 0xff, val.length & 0xff, ...Array.from(val))
  }
  const h = Uint8Array.from(hParts)
  const total = 12 + h.length + body.length + 4
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, total)
  view.setUint32(4, h.length)
  view.setUint32(8, crc32(out, 0, 8))
  out.set(h, 12)
  out.set(body, 12 + h.length)
  view.setUint32(total - 4, crc32(out, 0, total - 4))
  return out
}
