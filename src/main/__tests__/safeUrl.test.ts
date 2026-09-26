import { describe, it, expect } from 'vitest'
import { httpsOrDefault, isAppRendererUrl, safeExternalUrl } from '../safeUrl'

describe('safeUrl', () => {
  it('safeExternalUrl allows only absolute http(s)', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('smb://host/share')).toBeNull()
    expect(safeExternalUrl('example.com')).toBeNull()
  })

  it('isAppRendererUrl matches the dev origin or the packaged index file only', () => {
    const target = { devUrl: 'http://localhost:5173', fileUrl: 'file:///app/out/renderer/index.html' }
    expect(isAppRendererUrl('http://localhost:5173/#/chat', target)).toBe(true)
    expect(isAppRendererUrl('file:///app/out/renderer/index.html?x=1', target)).toBe(true)
    expect(isAppRendererUrl('http://localhost:8080/', target)).toBe(false)
    expect(isAppRendererUrl('file:///tmp/evil.html', target)).toBe(false)
    expect(isAppRendererUrl('https://evil.example/', target)).toBe(false)
    expect(isAppRendererUrl('http://localhost:5173/', { fileUrl: target.fileUrl })).toBe(false)
  })

  it('httpsOrDefault rejects non-https URIs', () => {
    const fb = 'https://github.com/login/device'
    expect(httpsOrDefault('https://github.com/login/device?x=1', fb)).toBe('https://github.com/login/device?x=1')
    expect(httpsOrDefault('file:///Applications/Calculator.app', fb)).toBe(fb)
    expect(httpsOrDefault('http://github.com/login/device', fb)).toBe(fb)
    expect(httpsOrDefault(undefined, fb)).toBe(fb)
  })
})
