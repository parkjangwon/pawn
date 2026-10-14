import { describe, expect, it } from 'vitest'
import { DEV_CSP, PROD_CSP, buildDevCsp, buildProdCsp } from '../csp'

describe('renderer CSP', () => {
  it('allows blob: scripts so the mods runtime can import hooks modules', () => {
    expect(PROD_CSP).toMatch(/script-src[^;]*\bblob:/)
    expect(DEV_CSP).toMatch(/script-src[^;]*\bblob:/)
  })

  it('keeps eval out of the production policy', () => {
    expect(PROD_CSP).not.toMatch(/unsafe-eval/)
  })

  it('keeps img-src free of remote sources', () => {
    const img = PROD_CSP.split(';').find((d) => d.includes('img-src')) || ''
    expect(img).not.toMatch(/https?:\/\//)
  })
})

describe('buildProdCsp', () => {
  const connect = (csp: string) => csp.split(';').find((d) => d.includes('connect-src')) || ''

  it('equals PROD_CSP with no extras', () => {
    expect(buildProdCsp([])).toBe(PROD_CSP)
  })

  it('appends exact http origins to connect-src only, deduped', () => {
    const csp = buildProdCsp(['http://192.168.0.10:11434', 'http://192.168.0.10:11434/v1', 'http://nas.lan'])
    expect(connect(csp).match(/http:\/\/192\.168\.0\.10:11434/g)).toHaveLength(1)
    expect(connect(csp)).toContain('http://nas.lan')
    expect(csp.split(';').find((d) => d.includes('img-src'))).not.toMatch(/https?:\/\//)
  })

  it('drops https, wildcards, credentials and garbage', () => {
    const csp = buildProdCsp(['https://x.com', 'http://*', 'http://*.lan:1', 'http://u:p@h:1', 'nope', 'http://a b;c'])
    expect(csp).toBe(PROD_CSP)
  })
})

describe('buildDevCsp', () => {
  it('matches DEV_CSP with no extras and appends the same http origins to connect-src only', () => {
    expect(buildDevCsp([])).toBe(DEV_CSP)
    const csp = buildDevCsp(['http://192.168.0.10:11434/v1', 'https://x.com', 'http://*'])
    const connect = csp.split(';').find((d) => d.includes('connect-src')) || ''
    expect(connect).toContain('http://192.168.0.10:11434')
    expect(connect).not.toContain('x.com')
    expect(csp.split(';').find((d) => d.includes('img-src'))).not.toContain('192.168')
  })
})
