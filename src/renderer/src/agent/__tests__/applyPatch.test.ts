import { describe, it, expect } from 'vitest'
import {
  parsePatch,
  applyChunks,
  summarizeOps,
  looksLikePatch,
  type PatchOp,
  type PatchChunk
} from '../applyPatch'

// --- helpers ---------------------------------------------------------------

function parseOk(text: string): PatchOp[] {
  const r = parsePatch(text)
  if (!r.ok) throw new Error(`expected parse ok, got: ${r.error}`)
  return r.ops
}

function updateChunks(op: PatchOp): PatchChunk[] {
  if (op.type !== 'update') throw new Error('not an update op')
  return op.chunks
}

// ---------------------------------------------------------------------------
// looksLikePatch
// ---------------------------------------------------------------------------

describe('looksLikePatch', () => {
  it('detects a Begin Patch marker', () => {
    expect(looksLikePatch('*** Begin Patch\n*** End Patch')).toBe(true)
  })
  it('detects headers without Begin Patch', () => {
    expect(looksLikePatch('*** Update File: a.py\n@@\n-x\n+y')).toBe(true)
  })
  it('detects inside a code fence', () => {
    expect(looksLikePatch('```\n*** Begin Patch\n*** End Patch\n```')).toBe(true)
  })
  it('rejects arbitrary text', () => {
    expect(looksLikePatch('just a normal sentence')).toBe(false)
  })
  it('rejects empty input', () => {
    expect(looksLikePatch('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parsePatch — Add / Delete / Update / Move
// ---------------------------------------------------------------------------

describe('parsePatch: add file', () => {
  it('parses an Add File op with content ending in newline', () => {
    const ops = parseOk('*** Begin Patch\n*** Add File: new.py\n+line one\n+line two\n*** End Patch')
    expect(ops.length).toBe(1)
    expect(ops[0]).toEqual({ type: 'add', path: 'new.py', content: 'line one\nline two\n' })
  })

  it('rejects Add File content lines not starting with +', () => {
    const r = parsePatch('*** Begin Patch\n*** Add File: new.py\n+ok\nbad line\n*** End Patch')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/must start with "\+"/)
  })

  it('rejects Add File missing a path', () => {
    const r = parsePatch('*** Begin Patch\n*** Add File: \n+x\n*** End Patch')
    expect(r.ok).toBe(false)
  })
})

describe('parsePatch: delete file', () => {
  it('parses a Delete File op', () => {
    const ops = parseOk('*** Begin Patch\n*** Delete File: old.py\n*** End Patch')
    expect(ops[0]).toEqual({ type: 'delete', path: 'old.py' })
  })
})

describe('parsePatch: update file', () => {
  it('parses a simple update chunk', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@\n context\n-old\n+new\n*** End Patch'
    )
    const chunks = updateChunks(ops[0])
    expect(chunks.length).toBe(1)
    expect(chunks[0].oldLines).toEqual(['context', 'old'])
    expect(chunks[0].newLines).toEqual(['context', 'new'])
    expect(chunks[0].isEndOfFile).toBe(false)
  })

  it('parses a Move to header', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n*** Move to: g.py\n@@\n-old\n+new\n*** End Patch'
    )
    expect(ops[0].type).toBe('update')
    if (ops[0].type === 'update') {
      expect(ops[0].moveTo).toBe('g.py')
    }
  })

  it('rejects an update with zero chunks', () => {
    const r = parsePatch('*** Begin Patch\n*** Update File: f.py\n*** End Patch')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no change chunks/)
  })

  it('parses multiple chunks separated by bare @@', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@\n-a\n+A\n@@\n-b\n+B\n*** End Patch'
    )
    const chunks = updateChunks(ops[0])
    expect(chunks.length).toBe(2)
    expect(chunks[0].oldLines).toEqual(['a'])
    expect(chunks[1].oldLines).toEqual(['b'])
  })

  it('parses single @@ context header', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@ class Foo\n-old\n+new\n*** End Patch'
    )
    const chunks = updateChunks(ops[0])
    expect(chunks[0].contexts).toEqual(['class Foo'])
  })

  it('parses nested @@ context headers', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@ class Foo\n@@     def bar(self):\n-old\n+new\n*** End Patch'
    )
    const chunks = updateChunks(ops[0])
    expect(chunks[0].contexts).toEqual(['class Foo', '    def bar(self):'])
  })

  it('marks a chunk with End of File', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@\n-old\n+new\n*** End of File\n*** End Patch'
    )
    const chunks = updateChunks(ops[0])
    expect(chunks[0].isEndOfFile).toBe(true)
  })

  it('treats blank line in a chunk as an empty context line', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@\n a\n\n b\n-old\n+new\n*** End Patch'
    )
    const chunks = updateChunks(ops[0])
    expect(chunks[0].oldLines).toEqual(['a', '', 'b', 'old'])
    expect(chunks[0].newLines).toEqual(['a', '', 'b', 'new'])
  })

  it('treats a marker-less line as context', () => {
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@\ncontext_no_marker\n-old\n+new\n*** End Patch'
    )
    const chunks = updateChunks(ops[0])
    expect(chunks[0].oldLines).toEqual(['context_no_marker', 'old'])
    expect(chunks[0].newLines).toEqual(['context_no_marker', 'new'])
  })
})

// ---------------------------------------------------------------------------
// parsePatch — tolerance
// ---------------------------------------------------------------------------

describe('parsePatch: tolerance', () => {
  it('tolerates leading/trailing whitespace', () => {
    const ops = parseOk('\n\n  *** Begin Patch\n*** Delete File: x.py\n*** End Patch  \n\n')
    expect(ops[0].type).toBe('delete')
  })

  it('tolerates a missing *** End Patch', () => {
    const ops = parseOk('*** Begin Patch\n*** Delete File: x.py')
    expect(ops[0].type).toBe('delete')
  })

  it('tolerates CRLF line endings', () => {
    const ops = parseOk('*** Begin Patch\r\n*** Add File: a.py\r\n+hi\r\n*** End Patch\r\n')
    expect(ops[0]).toEqual({ type: 'add', path: 'a.py', content: 'hi\n' })
  })

  it('unwraps a surrounding code fence', () => {
    const ops = parseOk('```patch\n*** Begin Patch\n*** Delete File: x.py\n*** End Patch\n```')
    expect(ops[0].type).toBe('delete')
  })

  it('unwraps a heredoc shell wrapper', () => {
    const text = [
      "apply_patch <<'EOF'",
      '*** Begin Patch',
      '*** Delete File: x.py',
      '*** End Patch',
      'EOF'
    ].join('\n')
    const ops = parseOk(text)
    expect(ops[0].type).toBe('delete')
  })

  it('unwraps a quoted apply_patch argument', () => {
    const inner = '*** Begin Patch\n*** Delete File: x.py\n*** End Patch'
    const ops = parseOk(`apply_patch "${inner}"`)
    expect(ops[0].type).toBe('delete')
  })
})

// ---------------------------------------------------------------------------
// parsePatch — errors
// ---------------------------------------------------------------------------

describe('parsePatch: errors', () => {
  it('errors when Begin Patch is missing', () => {
    const r = parsePatch('*** Delete File: x.py\n*** End Patch')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Begin Patch/)
  })

  it('errors on empty input', () => {
    const r = parsePatch('   ')
    expect(r.ok).toBe(false)
  })

  it('errors on a duplicate path', () => {
    const r = parsePatch(
      '*** Begin Patch\n*** Delete File: x.py\n*** Delete File: x.py\n*** End Patch'
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Duplicate path/)
  })

  it('errors on a stray unknown line', () => {
    const r = parsePatch('*** Begin Patch\nrandom junk\n*** End Patch')
    expect(r.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// applyChunks — basic
// ---------------------------------------------------------------------------

describe('applyChunks: basic update', () => {
  it('replaces a matched line', () => {
    const original = 'a\nb\nc\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@\n-b\n+B\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toBe('a\nB\nc\n')
  })

  it('applies multiple chunks sequentially', () => {
    const original = 'a\nb\nc\nd\n'
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@\n-a\n+A\n@@\n-d\n+D\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toBe('A\nb\nc\nD\n')
  })

  it('replaces with surrounding context lines', () => {
    const original = 'x\nfoo\ny\n'
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@\n x\n-foo\n+bar\n y\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('x\nbar\ny\n')
  })
})

// ---------------------------------------------------------------------------
// applyChunks — headers
// ---------------------------------------------------------------------------

describe('applyChunks: @@ headers', () => {
  it('narrows the region with a single header', () => {
    const original = ['def a():', '    x = 1', 'def b():', '    x = 1', ''].join('\n')
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@ def b():\n-    x = 1\n+    x = 2\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) {
      expect(r.content).toBe(['def a():', '    x = 1', 'def b():', '    x = 2', ''].join('\n'))
    }
  })

  it('narrows with nested headers', () => {
    const original = [
      'class A:',
      '    def m(self):',
      '        return 1',
      'class B:',
      '    def m(self):',
      '        return 1',
      ''
    ].join('\n')
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@ class B:\n@@     def m(self):\n-        return 1\n+        return 2\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) {
      expect(r.content).toContain('class B:\n    def m(self):\n        return 2')
      expect(r.content).toContain('class A:\n    def m(self):\n        return 1')
    }
  })
})

// ---------------------------------------------------------------------------
// applyChunks — insertion & EOF
// ---------------------------------------------------------------------------

describe('applyChunks: insertion and EOF', () => {
  it('pure insertion after a header', () => {
    const original = 'a\nb\nc\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@ a\n+inserted\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('a\ninserted\nb\nc\n')
  })

  it('pure insertion at end of file', () => {
    const original = 'a\nb\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@\n+tail\n*** End of File\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('a\nb\ntail\n')
  })

  it('End of File prefers the trailing match', () => {
    const original = 'x\nx\n'
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@\n-x\n+Z\n*** End of File\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    // Should replace the LAST x, not the first.
    if (r.ok) expect(r.content).toBe('x\nZ\n')
  })
})

// ---------------------------------------------------------------------------
// applyChunks — fuzzy matching
// ---------------------------------------------------------------------------

describe('applyChunks: fuzzy matching', () => {
  it('matches ignoring trailing whitespace', () => {
    const original = 'hello   \nworld\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@\n-hello\n+hi\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('hi\nworld\n')
  })

  it('matches ignoring leading + trailing whitespace', () => {
    const original = '    indented\nnext\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@\n-indented\n+done\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('done\nnext\n')
  })

  it('matches with unicode dash normalization', () => {
    const original = 'value \u2014 dashed\nkeep\n'
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@\n-value - dashed\n+plain\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('plain\nkeep\n')
  })

  it('matches with curly quote and nbsp normalization', () => {
    const original = '\u201Chello\u201D\u00A0world\nkeep\n'
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@\n-"hello" world\n+done\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('done\nkeep\n')
  })
})

// ---------------------------------------------------------------------------
// applyChunks — newline preservation
// ---------------------------------------------------------------------------

describe('applyChunks: newline preservation', () => {
  it('preserves CRLF line endings', () => {
    const original = 'a\r\nb\r\nc\r\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@\n-b\n+B\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('a\r\nB\r\nc\r\n')
  })

  it('preserves a missing trailing newline', () => {
    const original = 'a\nb\nc'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@\n-c\n+C\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('a\nb\nC')
  })

  it('preserves a present trailing newline', () => {
    const original = 'a\nb\nc\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f\n@@\n-c\n+C\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('a\nb\nC\n')
  })
})

// ---------------------------------------------------------------------------
// applyChunks — blank-line context
// ---------------------------------------------------------------------------

describe('applyChunks: blank-line context', () => {
  it('matches through a blank context line', () => {
    const original = 'a\n\nb\n'
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f\n@@\n a\n\n-b\n+B\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]))
    if (r.ok) expect(r.content).toBe('a\n\nB\n')
  })
})

// ---------------------------------------------------------------------------
// applyChunks — errors
// ---------------------------------------------------------------------------

describe('applyChunks: errors', () => {
  it('errors when the sequence is not found (message contains path + expected)', () => {
    const original = 'a\nb\nc\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: myfile.py\n@@\n-zzz\n+q\n*** End Patch')
    const r = applyChunks(original, updateChunks(ops[0]), 'myfile.py')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('myfile.py')
      expect(r.error).toContain('zzz')
      expect(r.error).toMatch(/Re-read/i)
    }
  })

  it('errors when a context header is not found', () => {
    const original = 'a\nb\n'
    const ops = parseOk(
      '*** Begin Patch\n*** Update File: f.py\n@@ nonexistent header\n-a\n+A\n*** End Patch'
    )
    const r = applyChunks(original, updateChunks(ops[0]), 'f.py')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/context header/i)
  })
})

// ---------------------------------------------------------------------------
// summarizeOps
// ---------------------------------------------------------------------------

describe('summarizeOps', () => {
  it('summarizes add / update+move / delete', () => {
    const ops = parseOk(
      [
        '*** Begin Patch',
        '*** Add File: new.py',
        '+x',
        '*** Update File: file.py',
        '*** Move to: renamed.py',
        '@@',
        '-a',
        '+b',
        '*** Delete File: old.py',
        '*** End Patch'
      ].join('\n')
    )
    expect(summarizeOps(ops)).toBe('A new.py, M file.py -> renamed.py, D old.py')
  })

  it('summarizes update without move', () => {
    const ops = parseOk('*** Begin Patch\n*** Update File: f.py\n@@\n-a\n+b\n*** End Patch')
    expect(summarizeOps(ops)).toBe('M f.py')
  })
})

// ---------------------------------------------------------------------------
// realistic multi-file patch (GPT-5 / Codex style)
// ---------------------------------------------------------------------------

describe('realistic multi-file patch', () => {
  const patch = [
    '*** Begin Patch',
    '*** Add File: src/util/hello.ts',
    '+export function hello(name: string): string {',
    '+  return `Hello, ${name}!`',
    '+}',
    '*** Update File: src/index.ts',
    '@@ export function main() {',
    ' import { hello } from "./util/hello"',
    "-  console.log('start')",
    "+  console.log(hello('world'))",
    '*** Delete File: src/legacy.ts',
    '*** End Patch'
  ].join('\n')

  it('parses all three ops', () => {
    const ops = parseOk(patch)
    expect(ops.length).toBe(3)
    expect(summarizeOps(ops)).toBe('A src/util/hello.ts, M src/index.ts, D src/legacy.ts')
  })

  it('applies the update chunk against real content', () => {
    const ops = parseOk(patch)
    const updateOp = ops.find((o) => o.type === 'update')!
    const original = [
      'export function main() {',
      '  import { hello } from "./util/hello"',
      "  console.log('start')",
      '}',
      ''
    ].join('\n')
    const r = applyChunks(original, updateChunks(updateOp), 'src/index.ts')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toContain("console.log(hello('world'))")
  })
})

// ---------------------------------------------------------------------------
// round-trip consistency
// ---------------------------------------------------------------------------

describe('round-trip consistency', () => {
  it('re-applying an already-applied patch fails cleanly', () => {
    const original = 'a\nb\nc\n'
    const ops = parseOk('*** Begin Patch\n*** Update File: f.py\n@@\n-b\n+B\n*** End Patch')
    const chunks = updateChunks(ops[0])
    const first = applyChunks(original, chunks, 'f.py')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyChunks(first.content, chunks, 'f.py')
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error).toContain('f.py')
      expect(second.error).toMatch(/not found|Re-read/i)
    }
  })
})
