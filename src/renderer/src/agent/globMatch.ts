/** Glob helpers shared by search_files / grep_search. */
export function compileGlob(pattern: string): RegExp | null {
  // Convert a glob pattern to a RegExp that understands:
  //   **  — matches zero or more path segments (across / boundaries)
  //   *   — matches within a single path segment (no /)
  //   ?   — matches exactly one non-/ character
  let regexStr = pattern
    // Replace ** first so it does not collide with single *
    .replace(/\*{2,}/g, '__GLOBSTAR__')
    // Escape all special regex chars except the remaining * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Now translate glob tokens to regex
    .replace(/\?/g, '[^/]')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*')
  try {
    return new RegExp(`^${regexStr}$`, 'i')
  } catch {
    return null
  }
}

// Test a filename against a glob. Pass a precompiled pattern to avoid
// rebuilding the regex for every file in a large walk.
export function matchesGlob(name: string, pattern: string, compiled?: RegExp | null): boolean {
  const re = compiled !== undefined ? compiled : compileGlob(pattern)
  if (re) return re.test(name)
  return name.toLowerCase().includes(pattern.toLowerCase())
}

