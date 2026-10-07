import { useCallback, useEffect, useState } from 'react'
import { tx } from '../i18n'
import { useAppStore } from '../stores/app'
import ConfirmDialog from './ConfirmDialog'
import Button from './Button'
import Input from './Input'
import Select from './Select'
import './RemoteSettingsPanel.css'

interface HostRow {
  id: string
  label: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  auth: 'key' | 'password'
  hasPassword: boolean
  createdAt: number
}

interface TestState {
  state: 'idle' | 'testing' | 'ok' | 'fail'
  detail?: string
}

export default function RemoteSettingsPanel(): React.JSX.Element {
  const projects = useAppStore((s) => s.projects)
  const setProjectExecutionTarget = useAppStore((s) => s.setProjectExecutionTarget)

  const [hosts, setHosts] = useState<HostRow[]>([])
  const [sshpassAvailable, setSshpassAvailable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [tests, setTests] = useState<Record<string, TestState>>({})

  // Add-host form
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')
  const [auth, setAuth] = useState<'key' | 'password'>('key')
  const [identityFile, setIdentityFile] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<HostRow | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const res = await window.api?.ssh?.list()?.catch?.(() => undefined)
    if (res?.ok) {
      setHosts(res.hosts)
      setSshpassAvailable(res.sshpassAvailable)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const folders = projects.filter((p) => p.id !== '__general__')

  const addHost = async (): Promise<void> => {
    if (!host.trim() || busy) return
    setBusy(true)
    setFormError(null)
    try {
      const res = await window.api?.ssh
        ?.add({
          label: label.trim() || undefined,
          host: host.trim(),
          user: user.trim() || undefined,
          port: port.trim() ? Number(port.trim()) : undefined,
          identityFile: auth === 'key' && identityFile.trim() ? identityFile.trim() : undefined,
          auth,
          password: auth === 'password' ? password : undefined
        })
        ?.catch?.((err: unknown): { ok: false; error: string } => ({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        }))
      if (res?.ok && res.host) {
        setLabel('')
        setHost('')
        setUser('')
        setPort('')
        setIdentityFile('')
        setPassword('')
        await reload()
      } else if (res && !res.ok) {
        setFormError(res.error || 'Could not add the host.')
      }
    } finally {
      setBusy(false)
    }
  }

  const removeHost = async (id: string): Promise<void> => {
    setRemoveError(null)
    const res = await window.api?.ssh?.remove(id)?.catch?.(() => undefined)
    if (res && !res.ok) setRemoveError(res.error || 'Operation failed')
    await reload()
  }

  const testHost = async (id: string): Promise<void> => {
    setTests((s) => ({ ...s, [id]: { state: 'testing' } }))
    const res = await window.api?.ssh?.test(id)?.catch?.(() => undefined)
    const result = res?.result
    setTests((s) => ({
      ...s,
      [id]: result?.ok ? { state: 'ok', detail: result.uname } : { state: 'fail', detail: result?.error || 'Operation failed' }
    }))
  }

  if (!window.api?.ssh) {
    return (
      <div className="settings-section remote-panel">
        <h2>{'Remote execution'}</h2>
        <p className="settings-desc">{'Run a project’s commands on a machine you reach over SSH — Tailscale hostnames work as-is. The agent, your API keys, and this app stay on this computer.'}</p>
        <div className="settings-empty">{'Remote execution is only available in the desktop app.'}</div>
      </div>
    )
  }

  return (
    <div className="settings-section remote-panel">
      {pendingRemove && (
        <ConfirmDialog
          title={'Remove'}
          message={`Remove ${pendingRemove.label || pendingRemove.host}? Sessions configured to run there will fall back to local.`}
          confirmLabel={'Remove'}
          danger
          onConfirm={() => {
            const target = pendingRemove
            setPendingRemove(null)
            void removeHost(target.id)
          }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
      <h2>{'Remote execution'}</h2>
      <p className="settings-desc">{'Run a project’s commands on a machine you reach over SSH — Tailscale hostnames work as-is. The agent, your API keys, and this app stay on this computer.'}</p>
      {removeError && <p className="remote-note remote-error">{removeError}</p>}

      <div className="settings-card">
        <div className="settings-row settings-row-stack">
          <span className="settings-row-label">{'Hosts'}</span>
          {loaded && hosts.length === 0 && (
            <span className="settings-row-desc">{'No hosts yet. Add one to run a project remotely.'}</span>
          )}
        </div>
        {hosts.map((h) => {
          const test = tests[h.id] || { state: 'idle' as const }
          return (
            <div className="settings-row" key={h.id}>
              <div className="settings-row-info">
                <span className="settings-row-label">{h.label}</span>
                <span className="settings-row-desc">
                  {h.user ? `${h.user}@` : ''}
                  {h.host}
                  {h.port && h.port !== 22 ? `:${h.port}` : ''} ·{' '}
                  {h.auth === 'password' ? 'Password' : 'SSH key (agent or default keys)'}
                  {h.hasPassword && h.auth === 'password' ? ' · ' + 'password saved' : ''}
                </span>
                {test.state === 'ok' && <span className="remote-test-ok">{`Connected · ${test.detail || ''}`}</span>}
                {test.state === 'fail' && <span className="remote-test-fail">{`Failed: ${test.detail || ''}`}</span>}
              </div>
              <div className="remote-actions">
                <Button type="button" variant="secondary" disabled={test.state === 'testing'} onClick={() => void testHost(h.id)}>
                  {test.state === 'testing' ? 'Testing…' : 'Test'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPendingRemove(h)}>
                  {'Remove'}
                </Button>
              </div>
            </div>
          )
        })}

        <div className="settings-row settings-row-stack">
          <span className="settings-row-label">{'Add host'}</span>
          <form
            className="remote-form"
            onSubmit={(e) => {
              e.preventDefault()
              void addHost()
            }}
          >
            <div className="remote-grid">
              <label className="remote-field">
                <span>{'Label'}</span>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="homelab" />
              </label>
              <label className="remote-field">
                <span>{'Hostname'}</span>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="box.tailnet-ts.net"
                  required
                />
              </label>
              <label className="remote-field">
                <span>{'User'}</span>
                <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" />
              </label>
              <label className="remote-field">
                <span>{'Port'}</span>
                <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" placeholder="22" />
              </label>
              <label className="remote-field">
                <span>{'Authentication'}</span>
                <Select value={auth} onChange={(e) => setAuth(e.target.value === 'password' ? 'password' : 'key')}>
                  <option value="key">{'SSH key (agent or default keys)'}</option>
                  <option value="password">{'Password'}</option>
                </Select>
              </label>
              {auth === 'key' ? (
                <label className="remote-field">
                  <span>{'Identity file path'}</span>
                  <Input
                    value={identityFile}
                    onChange={(e) => setIdentityFile(e.target.value)}
                    placeholder="~/.ssh/id_ed25519"
                  />
                </label>
              ) : (
                <label className="remote-field">
                  <span>{'Password'}</span>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
            </div>
            {auth === 'password' && !sshpassAvailable && (
              <p className="remote-note">{'Password auth needs the sshpass helper. Install it (macOS: brew install sshpass · Debian/Ubuntu: apt install sshpass) or use key auth.'}</p>
            )}
            {formError && <p className="remote-note remote-error">{formError}</p>}
            <Button type="submit" disabled={busy || !host.trim()}>
              {'Add host'}
            </Button>
          </form>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-row settings-row-stack">
          <div className="settings-row-info">
            <span className="settings-row-label">{'Projects'}</span>
            <span className="settings-row-desc">{'Pick where each project runs. File and debug tools stay local and are refused on remote projects — use shell tools there.'}</span>
          </div>
        </div>
        {folders.map((p) => {
          const isRemote = !!p.executionHost
          return (
            <div className="settings-row settings-row-stack" key={p.id}>
              <div className="remote-project-row">
                <span className="settings-row-label">{p.name}</span>
                <div className="remote-project-controls">
                  <Select
                    value={p.executionHost || ''}
                    onChange={(e) => {
                      const nextHost = e.target.value
                      setProjectExecutionTarget(p.id, nextHost, nextHost ? p.remotePath || '' : '')
                    }}
                  >
                    <option value="">{'This computer'}</option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    className="remote-path-input"
                    defaultValue={p.remotePath || ''}
                    key={p.id + ':' + (p.remotePath || '')}
                    disabled={!isRemote}
                    aria-label={'Absolute repo path on the host'}
                    placeholder={'Absolute repo path on the host'}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v !== (p.remotePath || '')) {
                        setProjectExecutionTarget(p.id, p.executionHost || '', v)
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}
        <p className="remote-note">{'Commands run with the host account’s permissions. The first connection trusts the host key (accept-new).'}</p>
      </div>
    </div>
  )
}
