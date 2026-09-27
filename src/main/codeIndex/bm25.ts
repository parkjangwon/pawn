/**
 * BM25 ranking over indexed documents.
 *
 * Each document carries its body tokens plus extra-weighted tokens for the
 * file path segments and the primary declared symbol. The weighting is applied
 * by repeating those tokens in the term-frequency counts.
 */

import { tokenize, tokenizePath } from './tokenize'

const K1 = 1.2
const B = 0.75
const SYMBOL_WEIGHT = 3
const PATH_WEIGHT = 2

export interface Bm25Doc {
  tf: Record<string, number>
  length: number
}

export interface Bm25Index {
  docs: Bm25Doc[]
  df: Record<string, number>
  avgLen: number
  n: number
}

/** Build the per-document token frequency map for a chunk. */
export function buildDocTokens(
  text: string,
  relPath: string,
  symbol?: string
): { tf: Record<string, number>; length: number } {
  const tf: Record<string, number> = {}
  let length = 0
  const add = (tokens: string[], weight: number): void => {
    for (const tok of tokens) {
      tf[tok] = (tf[tok] || 0) + weight
      length += weight
    }
  }
  add(tokenize(text), 1)
  add(tokenizePath(relPath), PATH_WEIGHT)
  if (symbol) add(tokenize(symbol), SYMBOL_WEIGHT)
  return { tf, length }
}

/** Assemble a BM25 index from precomputed doc token maps. */
export function buildBm25Index(docs: Bm25Doc[]): Bm25Index {
  const df: Record<string, number> = {}
  let totalLen = 0
  for (const d of docs) {
    totalLen += d.length
    for (const term of Object.keys(d.tf)) {
      df[term] = (df[term] || 0) + 1
    }
  }
  return {
    docs,
    df,
    n: docs.length,
    avgLen: docs.length ? totalLen / docs.length : 0
  }
}

/** Score all docs against a query; returns array of scores by doc index. */
export function bm25Scores(index: Bm25Index, queryTokens: string[]): number[] {
  const scores = new Array<number>(index.docs.length).fill(0)
  const uniqueQ = Array.from(new Set(queryTokens))
  for (const term of uniqueQ) {
    const df = index.df[term]
    if (!df) continue
    const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5))
    for (let i = 0; i < index.docs.length; i++) {
      const doc = index.docs[i]
      const f = doc.tf[term]
      if (!f) continue
      const denom = f + K1 * (1 - B + (B * doc.length) / (index.avgLen || 1))
      scores[i] += idf * ((f * (K1 + 1)) / denom)
    }
  }
  return scores
}

export { K1, B, SYMBOL_WEIGHT, PATH_WEIGHT }
