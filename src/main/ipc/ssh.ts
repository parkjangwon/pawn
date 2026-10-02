import { handleTrusted } from './trust'
import * as ssh from '../ssh'

/** SSH execution targets (Settings → Remote execution). The main process owns
 * the host list; execution requests are only honored for ids configured here. */
export function registerSshIpc(): void {
  handleTrusted('ssh:list', async () => {
    return { ok: true as const, hosts: ssh.listHosts(), sshpassAvailable: ssh.sshPassAvailable() }
  })

  handleTrusted('ssh:add', async (_, input: unknown) => {
    const res = ssh.addHost(input)
    return res.ok ? { ok: true as const, host: res.host } : { ok: false as const, error: res.error }
  })

  handleTrusted('ssh:remove', async (_, hostId: unknown) => {
    const res = ssh.removeHost(hostId)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.error || 'Failed' }
  })

  handleTrusted('ssh:test', async (_, hostId: unknown) => {
    if (typeof hostId !== 'string') return { ok: false as const, error: 'Invalid host id' }
    return { ok: true as const, result: await ssh.testConnection(hostId) }
  })
}
