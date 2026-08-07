/**
 * Local lightweight embeddings (no model download).
 * Improved hashed bag-of-features: words + CJK bigrams + char 3-grams +
 * position-weighted terms. Still not a neural embedder, but far better than
 * pure random hashing for hybrid FTS ranking. Dim 384.
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

function tokenize(text: string): Array<{ t: string; w: number }> {
  const lower = text.toLowerCase()
  const out: Array<{ t: string; w: number }> = []

  // Latin / code tokens
  const words = lower.match(/[a-z0-9_#./@+-]{2,}/g) || []
  for (const w of words) out.push({ t: w, w: 1 })

  // Hangul / CJK unigrams + bigrams
  const cjk = lower.match(/[\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    for (let i = 0; i < run.length; i++) {
      out.push({ t: run[i], w: 0.8 })
      if (i + 1 < run.length) out.push({ t: run.slice(i, i + 2), w: 1.2 })
    }
  }

  // Char 3-grams on compact text (stability for typos / partial match)
  const compact = lower.replace(/\s+/g, ' ').slice(0, 2000)
  for (let i = 0; i < compact.length - 2; i++) {
    out.push({ t: '§' + compact.slice(i, i + 3), w: 0.35 })
  }

  // Title-weight: first 80 chars tokens heavier
  const head = lower.slice(0, 80)
  for (const w of head.match(/[a-z0-9_\uac00-\ud7a3]{2,}/g) || []) {
    out.push({ t: w, w: 0.5 })
  }

  return out.slice(0, 800)
}

export function embedText(text: string): Float32Array {
  const v = new Float32Array(DIM)
  const tokens = tokenize(text || '')
  if (!tokens.length) return v
  for (const { t, w } of tokens) {
    const h = hash32(t)
    const idx = h % DIM
    const sign = h & 1 ? 1 : -1
    v[idx] += sign * w
    // second hash for stability (feature hashing)
    const h2 = hash32(t + '#')
    v[h2 % DIM] += (h2 & 1 ? 0.5 : -0.5) * w
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
