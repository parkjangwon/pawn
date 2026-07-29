let counter = 0

export function uid(prefix = ''): string {
  return `${prefix}${Date.now()}-${++counter}`
}
