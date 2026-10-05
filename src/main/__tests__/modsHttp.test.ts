import { describe, expect, it } from 'vitest'
import { modHttpFetch } from '../mods/http'
import { sortModsByOrder } from '../mods/discover'
import { planExecFile } from '../shellSandbox'

describe('mod http', () => {
  it('rejects non-http URLs and forwards method, headers, and body', async () => {
    const blocked = await modHttpFetch('file:///etc/passwd')
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toMatch(/http/)

    let seen: { method?: string; body?: string; header?: string } = {}
    const ok = await modHttpFetch(
      'https://example.test/hook',
      { method: 'POST', headers: { 'X-Mod': '1' }, body: '{"n":1}' },
      (async (_url, init) => {
        const headers = new Headers(init?.headers)
        seen = {
          method: init?.method,
          body: typeof init?.body === 'string' ? init.body : '',
          header: headers.get('X-Mod') || ''
        }
        return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } })
      }) as typeof fetch
    )
    expect(seen).toEqual({ method: 'POST', body: '{"n":1}', header: '1' })
    expect(ok.status).toBe(201)
    expect(ok.ok).toBe(true)
    expect(ok.text).toContain('ok')
  })
})

describe('mod order and process env', () => {
  it('runs listed plugins first and keeps the rest in discovery order', () => {
    const mods = [{ name: 'c' }, { name: 'a' }, { name: 'b' }]
    expect(sortModsByOrder(mods, ['b', 'a']).map((m) => m.name)).toEqual(['b', 'a', 'c'])
  })

  it('merges extraEnv after the sandbox env', () => {
    const plan = planExecFile('echo', ['hi'], undefined, { enabled: false, extraEnv: { MOD_NOTE: 'kept' } })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.plan.env.MOD_NOTE).toBe('kept')
  })
})
