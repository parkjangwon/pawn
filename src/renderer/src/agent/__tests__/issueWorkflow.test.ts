import { describe, it, expect } from 'vitest'
import { parseIssuePrArg, buildIssuePrPlaybook } from '../issueWorkflow'

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
  })
})
