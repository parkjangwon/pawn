/**
 * Platform-specific helpers for the PTY terminal. Kept out of index.ts so the
 * shell selection and dimension clamping are unit-testable.
 */

export function clampDim(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(500, Math.max(2, n))
}

export function pickShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): { file: string; args: string[] } {
  if (platform === 'win32') {
    const comspec = env.ComSpec
    return comspec ? { file: comspec, args: [] } : { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  return { file: env.SHELL || '/bin/zsh', args: [] }
}
