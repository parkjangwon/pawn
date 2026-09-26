// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkPermission, autoApproves } from '../toolPermission'
import { usePermissionStore } from '../../stores/permission'
import { useProviderStore } from '../../stores/provider'

async function waitForPending(n = 1): Promise<void> {
  await vi.waitFor(() => {
    expect(usePermissionStore.getState().pending).toHaveLength(n)
  })
}

describe('checkPermission', () => {
  beforeEach(() => {
    usePermissionStore.setState({ pending: [], sessionApproved: new Set() })
    useProviderStore.setState({ permissionMode: 'ask' })
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  it('queues a prompt for risky tools in ask mode', async () => {
    const promise = checkPermission('write_file', { path: '/x' })
    await waitForPending(1)
    usePermissionStore.getState().resolve(usePermissionStore.getState().pending[0].id, true)
    await expect(promise).resolves.toBe(true)
  })

  it('skips the prompt for session-approved types', async () => {
    usePermissionStore.getState().approveSession('file_write')
    await expect(checkPermission('write_file', { path: '/x' })).resolves.toBe(true)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })

  it('auto-approves safe tools in auto mode', async () => {
    useProviderStore.setState({ permissionMode: 'auto' })
    await expect(checkPermission('read_file', { path: '/x' })).resolves.toBe(true)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })

  it('headless ask mode allows safe tools and denies risky ones', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    await expect(checkPermission('read_file', { path: '/x' })).resolves.toBe(true)
    await expect(checkPermission('shell_exec', { command: 'x' })).resolves.toBe(false)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })

  it('prompts for egress tools even in auto mode', async () => {
    useProviderStore.setState({ permissionMode: 'auto' })
    const promise = checkPermission('web_fetch', { url: 'https://example.com/?q=secret' })
    await waitForPending(1)
    expect(usePermissionStore.getState().pending[0].type).toBe('network')
    usePermissionStore.getState().resolve(usePermissionStore.getState().pending[0].id, false)
    await expect(promise).resolves.toBe(false)
  })

  it('does not let a session file_read approval cover network egress', async () => {
    usePermissionStore.getState().approveSession('file_read')
    const promise = checkPermission('web_fetch', { url: 'https://example.com/' })
    await waitForPending(1)
    usePermissionStore.getState().resolve(usePermissionStore.getState().pending[0].id, true)
    await expect(promise).resolves.toBe(true)
  })

  it('autoApproves excludes egress tools outside yolo', () => {
    for (const name of ['web_fetch', 'web_research', 'browser_navigate', 'memory_save']) {
      expect(autoApproves(name, 'auto', false)).toBe(false)
      expect(autoApproves(name, 'ask', true)).toBe(false)
      expect(autoApproves(name, 'yolo', false)).toBe(true)
    }
    expect(autoApproves('read_file', 'auto', false)).toBe(true)
    expect(autoApproves('read_file', 'ask', false)).toBe(false)
  })
})
