// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GitSummaryChip from '../GitSummaryChip'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function mockShell(statusOut: string, diffOut = '', statusExit = 0, diffExit = 0): void {
  ;(window as any).api = {
    shell: {
      exec: vi.fn((cmd: string) => {
        if (cmd.startsWith('git status')) return Promise.resolve({ stdout: statusOut, stderr: '', exitCode: statusExit })
        if (cmd.startsWith('git diff')) return Promise.resolve({ stdout: diffOut, stderr: '', exitCode: diffExit })
        if (cmd === 'git branch') return Promise.resolve({ stdout: '  main\n* master\n', stderr: '', exitCode: 0 })
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 })
      }),
      execFile: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    }
  }
}

beforeEach(() => {
  delete (window as any).__openRightPanelTab
})

describe('GitSummaryChip', () => {
  it('renders nothing outside a git repo', async () => {
    mockShell('', '', 128)
    const { container } = render(<GitSummaryChip projectPath="/tmp/not-a-repo" />)
    await waitFor(() => expect(container.querySelector('.git-chip-wrapper')).not.toBeInTheDocument())
  })

  it('shows the branch and a live insertions/deletions stat once dirty', async () => {
    mockShell(
      '## master...origin/master [ahead 2]\n M src/a.ts\n?? src/b.ts\n',
      ' 2 files changed, 11 insertions(+), 3 deletions(-)'
    )
    render(<GitSummaryChip projectPath="/repo" />)
    expect(await screen.findByText('master')).toBeInTheDocument()
    expect(screen.getByText('+11')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()
    expect(screen.getByText('↑2')).toBeInTheDocument()
  })

  it('opens a popover with quick jumps into the right panel tabs', async () => {
    mockShell('## master\n', '')
    const openTab = vi.fn()
    ;(window as any).__openRightPanelTab = openTab
    render(<GitSummaryChip projectPath="/repo" />)
    fireEvent.click(await screen.findByTitle('rightPanel.branch'))
    fireEvent.click(await screen.findByText('rightPanel.tools.git'))
    expect(openTab).toHaveBeenCalledWith('git')
  })
})
