import { describe, expect, it } from 'vitest'
import { DEV_CSP, PROD_CSP } from '../csp'

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
