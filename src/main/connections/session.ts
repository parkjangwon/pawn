import type { ConnectionProvider } from './types'

export type ConnectProgress = {
  provider: ConnectionProvider
  phase: 'browser' | 'device_code' | 'polling' | 'cancelled'
  userCode?: string
  verificationUri?: string
  message?: string
}

export type ConnectHooks = {
  signal?: AbortSignal
  onProgress?: (p: Omit<ConnectProgress, 'provider'>) => void
}

type Session = {
  abort: AbortController
  close?: () => void
}

const sessions = new Map<ConnectionProvider, Session>()

export function beginConnectSession(provider: ConnectionProvider): AbortSignal {
  cancelConnect(provider)
  const abort = new AbortController()
  sessions.set(provider, { abort })
  return abort.signal
}

export function registerSessionCloser(provider: ConnectionProvider, close: () => void): void {
  const s = sessions.get(provider)
  if (s) s.close = close
}

export function endConnectSession(provider: ConnectionProvider): void {
  sessions.delete(provider)
}

export function cancelConnect(provider: ConnectionProvider): boolean {
  const s = sessions.get(provider)
  if (!s) return false
  try {
    s.abort.abort()
  } catch { /* ignore */ }
  try {
    s.close?.()
  } catch { /* ignore */ }
  sessions.delete(provider)
  return true
}

export function isConnectCancelled(signal?: AbortSignal): boolean {
  return !!signal?.aborted
}
