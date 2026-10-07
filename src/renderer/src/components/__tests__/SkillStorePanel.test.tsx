// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import type { TFunction } from 'i18next'
import SkillStorePanel from '../SkillStorePanel'

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)) as unknown as TFunction

const popular: RegistrySkill[] = Array.from({ length: 14 }, (_, i) => ({
  id: `acme/skills/skill-${String.fromCharCode(97 + i)}`,
  name: `skill-${String.fromCharCode(97 + i)}`,
  source: 'acme/skills',
  installs: 1000 - i
}))
const installed = new Set<string>(['skill-b'])
const api = {
  search: vi.fn(async (q: string) => (q === 'pdf' ? { skills: [{ id: 'anthropics/skills/pdf', name: 'pdf', source: 'anthropics/skills', installs: 201_700 }] } : { skills: popular })),
  details: vi.fn(async (id: string) => ({ description: `About ${id.split('/')[2]}`, firstSeen: id.endsWith('-n') ? '2026-09-01' : '2026-01-01' })),
  install: vi.fn(async (id: string) => {
    installed.add(id.split('/')[2])
    return { ok: true as const, name: id.split('/')[2], path: `/h/.agents/skills/${id.split('/')[2]}` }
  }),
  remove: vi.fn(async (name: string) => {
    installed.delete(name)
    return { ok: true }
  }),
  installed: vi.fn(async () => [...installed])
}

beforeEach(() => {
  vi.useRealTimers()
  ;(window as any).api = { skills: api }
  Object.values(api).forEach((f) => f.mockClear())
  installed.clear()
  installed.add('skill-b')
})

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}
const names = (): string[] => Array.from(document.querySelectorAll('.skill-store-name')).map((n) => n.textContent || '')

describe('SkillStorePanel', () => {
  it('shows the most installed skills with descriptions, paged 12 at a time', async () => {
    render(<SkillStorePanel state={{ t } as never} />)
    await flush()
    await flush()
    expect(api.search).toHaveBeenCalledWith('')
    expect(names()).toHaveLength(12)
    expect(names()[0]).toBe('skill-a')
    expect(await screen.findByText('About skill-a')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.skillStore.next' }))
    expect(names()).toEqual(['skill-m', 'skill-n'])
    expect(screen.getByText(/settings.skillStore.pageOf/)).toHaveTextContent('"page":2,"pages":2')
  })

  it('sorts by name and by newest (first-seen date)', async () => {
    render(<SkillStorePanel state={{ t } as never} />)
    await flush()
    fireEvent.click(screen.getByRole('radio', { name: 'settings.skillStore.sort.newest' }))
    await flush()
    await flush()
    expect(names()[0]).toBe('skill-n')
    fireEvent.click(screen.getByRole('radio', { name: 'settings.skillStore.sort.name' }))
    expect(names().slice(0, 3)).toEqual(['skill-a', 'skill-b', 'skill-c'])
  })

  it('searches by name, installs and removes', async () => {
    render(<SkillStorePanel state={{ t } as never} />)
    await flush()
    // Installed skills show Remove instead of Install.
    const b = document.querySelectorAll('.skill-store-card')[1] as HTMLElement
    expect(within(b).getByText('settings.skillStore.installedBadge')).toBeInTheDocument()
    fireEvent.click(within(b).getByRole('button', { name: 'settings.skillStore.remove' }))
    await flush()
    expect(api.remove).toHaveBeenCalledWith('skill-b')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pdf' } })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })
    await flush()
    expect(api.search).toHaveBeenLastCalledWith('pdf')
    expect(names()).toEqual(['pdf'])
    fireEvent.click(screen.getByRole('button', { name: 'settings.skillStore.install' }))
    await flush()
    expect(api.install).toHaveBeenCalledWith('anthropics/skills/pdf')
    expect(await screen.findByText('settings.skillStore.installedBadge')).toBeInTheDocument()
    expect(screen.getByText(/settings.skillStore.installed:/)).toHaveTextContent('"name":"pdf"')
  })
})
