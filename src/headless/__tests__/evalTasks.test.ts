/**
 * Self-test for the eval suite's own checks: every task's check must PASS on
 * its reference solution and FAIL on the initial (broken) files. A check that
 * passes both ways measures nothing.
 */
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { BUILTIN_TASKS, type EvalCheckContext } from '../evalTasks'

const execAsync = promisify(exec)

async function materialize(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
}

function makeCtx(dir: string): EvalCheckContext {
  return {
    dir,
    finalText: '',
    run: async (command, timeoutMs) => {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: dir, timeout: timeoutMs ?? 30_000 })
        return { exitCode: 0, stdout, stderr }
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string }
        return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
      }
    },
    read: async (rel) => {
      try {
        return await readFile(join(dir, rel), 'utf8')
      } catch {
        return null
      }
    }
  }
}

const TARGET_IDS = ['money-thousands', 'parse-duration-spec']

describe('eval task checks (reference passes, initial fails)', () => {
  for (const id of TARGET_IDS) {
    const task = BUILTIN_TASKS.find((t) => t.id === id)
    if (!task || !task.reference) continue

    it(`${id}: check passes on the reference solution`, async () => {
      const dir = await mkdtemp(join(tmpdir(), `pawn-eval-${id}-`))
      try {
        await materialize(dir, { ...task.files, ...task.reference })
        const result = await task.check(makeCtx(dir))
        expect(result).toEqual({ pass: true })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 120_000)

    it(`${id}: check fails on the initial files`, async () => {
      const dir = await mkdtemp(join(tmpdir(), `pawn-eval-${id}-init-`))
      try {
        await materialize(dir, task.files)
        const result = await task.check(makeCtx(dir))
        expect(result.pass).toBe(false)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 120_000)
  }
})
