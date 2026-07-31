// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { usePermissionStore } from '../permission'

beforeEach(() => {
  usePermissionStore.setState({ pending: [] })
})

describe('permission store', () => {
  it('queues a request and resolves it as approved', async () => {
    const promise = usePermissionStore.getState().request({ type: 'shell_exec', description: 'Run rm -rf' })
    const pending = usePermissionStore.getState().pending
    expect(pending).toHaveLength(1)
    expect(pending[0].type).toBe('shell_exec')
    expect(pending[0].description).toBe('Run rm -rf')

    usePermissionStore.getState().resolve(pending[0].id, true)
    await expect(promise).resolves.toBe(true)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })

  it('resolves as denied and keeps other requests pending', async () => {
    const denied = usePermissionStore.getState().request({ type: 'file_write', description: 'Write' })
    const other = usePermissionStore.getState().request({ type: 'file_read', description: 'Read' })

    usePermissionStore.getState().resolve(usePermissionStore.getState().pending[0].id, false)
    await expect(denied).resolves.toBe(false)
    expect(usePermissionStore.getState().pending).toHaveLength(1)
    expect(usePermissionStore.getState().pending[0].description).toBe('Read')

    usePermissionStore.getState().resolve(usePermissionStore.getState().pending[0].id, true)
    await expect(other).resolves.toBe(true)
  })

  it('ignores unknown ids', () => {
    usePermissionStore.getState().resolve('perm-999', true)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })
})
