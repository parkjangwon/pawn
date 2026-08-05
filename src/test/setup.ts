/**
 * Node >= 22 ships an experimental global `localStorage` getter that returns
 * undefined unless `--localstorage-file` is passed. It shadows jsdom's own
 * localStorage inside vitest (populateGlobal skips keys that already exist on
 * the Node global), which crashes jsdom suites with "Cannot read properties of
 * undefined (reading 'getItem')". A small in-memory implementation keeps the
 * suite identical across Node 22, 26, and later.
 */
const storageMap = new Map<string, string>()
const memoryLocalStorage = {
  get length(): number {
    return storageMap.size
  },
  clear(): void {
    storageMap.clear()
  },
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key)! : null
  },
  key(index: number): string | null {
    return Array.from(storageMap.keys())[index] ?? null
  },
  removeItem(key: string): void {
    storageMap.delete(key)
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, String(value))
  }
}
// Detect Node's webstorage stub without invoking it — reading the getter would
// emit an ExperimentalWarning on every worker. Vitest's own jsdom bridge (a
// getter that forwards to the jsdom window) is left untouched.
const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const isNodeWebStorageStub =
  localStorageDescriptor !== undefined &&
  typeof localStorageDescriptor.get === 'function' &&
  /webstorage/i.test(Function.prototype.toString.call(localStorageDescriptor.get))
if (localStorageDescriptor === undefined || isNodeWebStorageStub) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryLocalStorage,
    writable: true,
    configurable: true
  })
}

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement matchMedia; the theme store reads it at import time.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
}

afterEach(() => {
  cleanup()
})
