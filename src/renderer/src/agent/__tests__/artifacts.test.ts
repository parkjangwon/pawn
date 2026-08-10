// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  defaultArtifactsDir,
  listArtifactsDir,
  writeArtifactTo
} from '../artifacts'

function mockFs(overrides: Record<string, unknown> = {}): void {
  ;(window as any).api = {
    fs: {
      downloadsPath: vi.fn().mockResolvedValue('/Downloads'),
      homeDir: vi.fn().mockResolvedValue('/Home'),
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue({}),
      listDir: vi.fn().mockResolvedValue([]),
      writeFile: vi.fn().mockResolvedValue({}),
      ...overrides
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('defaultArtifactsDir fallback', () => {
  it('uses <downloads>/pawn-artifacts when no project is open', async () => {
    mockFs()
    expect(await defaultArtifactsDir()).toBe('/Downloads/pawn-artifacts')
  })

  it('falls back to <home>/pawn-artifacts when downloads is unavailable', async () => {
    mockFs({ downloadsPath: vi.fn().mockResolvedValue(null) })
    expect(await defaultArtifactsDir()).toBe('/Home/pawn-artifacts')
  })

  it('returns null when no path API is available', async () => {
    ;(window as any).api = { fs: {} }
    expect(await defaultArtifactsDir()).toBeNull()
  })
})

describe('writeArtifactTo', () => {
  beforeEach(() => {
    mockFs()
  })

  it('writes into the given directory and reports the full path', async () => {
    const writeFile = (window as any).api.fs.writeFile as ReturnType<typeof vi.fn>
    const res = await writeArtifactTo('/Downloads/pawn-artifacts', 'r.md', '# Report')
    expect(writeFile).toHaveBeenCalledWith('/Downloads/pawn-artifacts/r.md', '# Report')
    expect(res.ok).toBe(true)
    expect(res.path).toBe('/Downloads/pawn-artifacts/r.md')
  })

  it('rejects unsafe artifact names', async () => {
    await expect(writeArtifactTo('/Downloads/pawn-artifacts', '../escape.md', 'x')).resolves.toMatchObject({
      ok: false
    })
    await expect(writeArtifactTo('/Downloads/pawn-artifacts', '/abs.md', 'x')).resolves.toMatchObject({
      ok: false
    })
  })

  it('propagates write errors', async () => {
    mockFs({ writeFile: vi.fn().mockResolvedValue({ error: 'disk full' }) })
    await expect(writeArtifactTo('/Downloads/pawn-artifacts', 'r.md', 'x')).resolves.toEqual({
      ok: false,
      error: 'disk full'
    })
  })
})

describe('listArtifactsDir', () => {
  it('lists entries of an explicit artifacts root', async () => {
    mockFs({
      listDir: vi.fn().mockResolvedValue([
        { name: 'r.md', isDirectory: false },
        { name: 'notes', isDirectory: true }
      ])
    })
    const text = await listArtifactsDir('/Downloads/pawn-artifacts')
    expect(text).toContain('file r.md')
    expect(text).toContain('dir notes')
  })

  it('rejects traversal in the subdir argument', async () => {
    mockFs()
    const text = await listArtifactsDir('/Downloads/pawn-artifacts', '../secret')
    expect(text).toContain('Invalid subdirectory')
    expect((window as any).api.fs.listDir).not.toHaveBeenCalled()
  })
})
