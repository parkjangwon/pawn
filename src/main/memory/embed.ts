/**
 * Local lightweight embeddings (no model download).
 * Character + word hashed bag into fixed dim — good enough for hybrid ranking
 * with FTS5. Cosine similarity in [0,1] after normalization.
 */

const DIM = 384

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const words = lower.match(/[a-z0-9_#./@+-]{2,}|[\uac00-\ud7a3]{1,}/g) || []
  const grams: string[] = []
  const compact = lower.replace(/\s+/g, ' ').slice(0, 2000)
  for (let i = 0; i < compact.length - 2; i++) {
    grams.push(compact.slice(i, i + 3))
  }
  return [...words, ...grams.slice(0, 400)]
}

export function embedText(text: string): Float32Array {
  const v = new Float32Array(DIM)
  const tokens = tokenize(text || '')
  if (!tokens.length) return v
  for (const t of tokens) {
    const h = hash32(t)
    const idx = h % DIM
    const sign = h & 1 ? 1 : -1
    v[idx] += sign
    // second hash for stability
    const h2 = hash32(t + '#')
    v[h2 % DIM] += (h2 & 1 ? 0.5 : -0.5)
  }
  // L2 normalize
  let norm = 0
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < DIM; i++) v[i] /= norm
  return v
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  // embeddings are unit-norm → s in [-1,1]; map to [0,1]
  return Math.max(0, Math.min(1, (s + 1) / 2))
}

export function packEmbedding(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function unpackEmbedding(buf: Buffer | Uint8Array | null): Float32Array | null {
  if (!buf || buf.byteLength < 4) return null
  const copy = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (copy.byteLength % 4 !== 0) return null
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

export const EMBED_DIM = DIM
