import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseIssuePrArg,
  buildIssuePrPlaybook,
  parseGithubIssueRef,
  parseGitlabIssueRef,
  prefetchIssueContext
} from '../issueWorkflow'

describe('issueWorkflow', () => {
  it('parses issue refs', () => {
    expect(parseIssuePrArg('42')).toEqual({ issueRef: '#42' })
    expect(parseIssuePrArg('#7')).toEqual({ issueRef: '#7' })
    expect(parseIssuePrArg('acme/app#9')).toEqual({ issueRef: '#9', repoHint: 'acme/app' })
    expect(parseIssuePrArg('https://github.com/a/b/issues/3')?.issueRef).toContain('http')
  })

  it('builds a playbook with steps', () => {
    const text = buildIssuePrPlaybook({ issueRef: '#1', repoHint: 'a/b' })
    expect(text).toContain('issue_to_pr_playbook')
    expect(text).toContain('run_checks')
    expect(text).toContain('git_pr_ready')
    expect(text).toContain('github_get_issue')
  })

  it('embeds prefetched issue and skips step-1 fetch guidance', () => {
    const text = buildIssuePrPlaybook({
      issueRef: '#1',
      repoHint: 'a/b',
      prefetched: 'title: Fix login\nbody here'
    })
    expect(text).toContain('Prefetched issue')
    expect(text).toContain('Fix login')
    expect(text).toContain('Remaining steps')
    expect(text).not.toContain('Resolve issue details')
  })

  it('parses GitHub issue refs', () => {
    expect(parseGithubIssueRef('https://github.com/acme/app/issues/12')).toEqual({
      owner: 'acme',
      repo: 'app',
      number: 12
    })
    expect(parseGithubIssueRef('acme/app#3')).toEqual({
      owner: 'acme',
      repo: 'app',
      number: 3
    })
    expect(parseGithubIssueRef('#9', 'acme/app')).toEqual({
      owner: 'acme',
      repo: 'app',
      number: 9
    })
    expect(parseGithubIssueRef('#9')).toBeNull()
  })

  it('parses GitLab issue refs', () => {
    expect(parseGitlabIssueRef('https://gitlab.com/group/proj/-/issues/4')).toEqual({
      project: 'group/proj',
      number: 4
    })
    expect(parseGitlabIssueRef('#2', 'group/sub/proj')).toEqual({
      project: 'group/sub/proj',
      number: 2
    })
  })

  describe('prefetchIssueContext', () => {
    const runTool = vi.fn()

    beforeEach(() => {
      runTool.mockReset()
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: {
          api: {
            connections: { runTool }
          }
        }
      })
    })

    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (globalThis as { window?: unknown }).window
    })

    it('prefers github_get_issue via connections.runTool', async () => {
      runTool.mockResolvedValue({
        ok: true,
        text: '#12 Fix login\nstate: open\n\nPlease fix auth'
      })
      const out = await prefetchIssueContext({
        issueRef: 'https://github.com/acme/app/issues/12'
      })
      expect(runTool).toHaveBeenCalledWith('github_get_issue', {
        repo: 'acme/app',
        number: 12
      })
      expect(out).toContain('source: github acme/app#12')
      expect(out).toContain('Fix login')
    })

    it('returns undefined when not connected', async () => {
      runTool.mockResolvedValue({ ok: false, error: 'not connected' })
      const out = await prefetchIssueContext({
        issueRef: 'acme/app#1'
      })
      expect(out).toBeUndefined()
    })
  })
})
