/** Deep-freeze plain data so hooks must copy before mutating. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value as object)) {
    const child = (value as Record<string | symbol, unknown>)[key]
    if (child && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(value)
}
