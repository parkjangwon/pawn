import { describe, it, expect, vi } from 'vitest'

const APP_URL = 'file:///app/out/renderer/index.html'
const mainWc = { mainFrame: { processId: 1, routingId: 1, parent: null, url: APP_URL } }

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../window', () => ({
  getMainWindow: () => ({ webContents: mainWc }),
  getHeadlessWindow: () => null,
  isAppUrl: (u: string) => u === APP_URL
}))

import { isTrustedSender } from '../ipc/trust'

type Ev = Parameters<typeof isTrustedSender>[0]
const ev = (sender: unknown, senderFrame: unknown): Ev => ({ sender, senderFrame }) as unknown as Ev

describe('isTrustedSender', () => {
  it('trusts the main window top frame showing the app document', () => {
    expect(isTrustedSender(ev(mainWc, { ...mainWc.mainFrame }))).toBe(true)
  })

  it('rejects foreign webContents', () => {
    expect(isTrustedSender(ev({ mainFrame: mainWc.mainFrame }, mainWc.mainFrame))).toBe(false)
  })

  it('rejects child frames and missing frames', () => {
    const child = { processId: 1, routingId: 7, parent: mainWc.mainFrame, url: APP_URL }
    expect(isTrustedSender(ev(mainWc, child))).toBe(false)
    expect(isTrustedSender(ev(mainWc, null))).toBe(false)
  })

  it('rejects the main window after it navigated away from the app', () => {
    const nav = { ...mainWc.mainFrame, url: 'https://evil.example/' }
    expect(isTrustedSender(ev(mainWc, nav))).toBe(false)
  })
})
