// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { usePermissionStore, matchShellPrefix } from '../permission'

describe('matchShellPrefix', () => {
  it('matches the prefix on a token boundary', () => {
    expect(matchShellPrefix('npm test', 'npm test')).toBe(true)
    expect(matchShellPrefix('npm test -- --watch', 'npm test')).toBe(true)
    expect(matchShellPrefix('npm\ttest', 'npm')).toBe(true)
    expect(matchShellPrefix('npmx install', 'npm')).toBe(false)
  })

  it('refuses commands that chain or substitute other commands', () => {
    for (const cmd of [
      'npm test; rm -rf ~',
      'npm test && curl evil',
      'npm test | sh',
      'npm test `id`',
      'npm test $(id)',
      'npm test > ~/.zshrc',
      'npm test\nrm -rf ~'
    ]) {
      expect(matchShellPrefix(cmd, 'npm test')).toBe(false)
    }
  })

  it('applies to isAllowedByRules for shell_prefix rules', () => {
    usePermissionStore.setState({ sessionRules: [], alwaysRules: [] })
    usePermissionStore.getState().addRule({ kind: 'shell_prefix', prefix: 'git status', scope: 'session' })
    const s = usePermissionStore.getState()
    expect(s.isAllowedByRules('shell_exec', { command: 'git status -s' })).toBe(true)
    expect(s.isAllowedByRules('shell_exec', { command: 'git status; rm -rf /' })).toBe(false)
  })
})

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

  it('auto-denies and removes a request when its signal aborts', async () => {
    const controller = new AbortController()
    const promise = usePermissionStore.getState().request(
      { type: 'shell_exec', description: 'Run' },
      controller.signal
    )
    expect(usePermissionStore.getState().pending).toHaveLength(1)

    controller.abort()
    await expect(promise).resolves.toBe(false)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })

  it('resolves false immediately for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const promise = usePermissionStore.getState().request(
      { type: 'shell_exec', description: 'Run' },
      controller.signal
    )
    await expect(promise).resolves.toBe(false)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })

  it('denyAll rejects every pending prompt', async () => {
    const a = usePermissionStore.getState().request({ type: 'shell_exec', description: 'A' })
    const b = usePermissionStore.getState().request({ type: 'file_write', description: 'B' })
    expect(usePermissionStore.getState().pending).toHaveLength(2)
    usePermissionStore.getState().denyAll()
    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe(false)
    expect(usePermissionStore.getState().pending).toHaveLength(0)
  })
})
