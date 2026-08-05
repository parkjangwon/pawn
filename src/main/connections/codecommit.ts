/**
 * AWS CodeCommit connection via IAM access key credentials (token-style, no OAuth).
 * Secret access key is stored like a PAT under safeStorage.
 */

import { loadTokens, saveTokens, clearTokens } from './store'
import { codecommitApi, stsGetCallerIdentity, type AwsCredentials } from './awsSign'
import type { PatCredentials, StoredTokens } from './types'

export function getCodeCommitCredentials(): AwsCredentials | null {
  const t = loadTokens('codecommit')
  if (!t?.accessToken || !t.accessKeyId || !t.region) return null
  return {
    accessKeyId: t.accessKeyId,
    secretAccessKey: t.accessToken,
    sessionToken: t.sessionToken,
    region: t.region
  }
}

export async function connectCodeCommit(creds: PatCredentials): Promise<{
  ok?: boolean
  error?: string
  accountLabel?: string
}> {
  const region = (creds.region || '').trim()
  const accessKeyId = (creds.accessKeyId || '').trim()
  const secretAccessKey = (creds.secretAccessKey || creds.token || '').trim()
  const sessionToken = (creds.sessionToken || '').trim() || undefined

  if (!region) return { error: 'AWS region is required (e.g. ap-northeast-2)' }
  if (!accessKeyId) return { error: 'AWS access key ID is required' }
  if (!secretAccessKey) return { error: 'AWS secret access key is required' }
  if (!/^[a-z0-9-]+$/i.test(region)) {
    return { error: 'Invalid AWS region format' }
  }

  const credentials: AwsCredentials = {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region
  }

  try {
    // Verify CodeCommit access first
    const list = await codecommitApi(credentials, 'ListRepositories', {
      maxResults: 1
    })
    if (!list.ok) {
      const msg =
        typeof list.body === 'object' && list.body
          ? ((list.body as { message?: string; Message?: string; __type?: string }).message ||
              (list.body as { Message?: string }).Message ||
              (list.body as { __type?: string }).__type ||
              JSON.stringify(list.body).slice(0, 200))
          : list.text.slice(0, 200)
      if (list.status === 403 || list.status === 401) {
        return {
          error: `CodeCommit auth failed (${list.status}): check IAM keys and codecommit:ListRepositories permission`
        }
      }
      return { error: `CodeCommit connection failed (${list.status}): ${msg}` }
    }

    let accountLabel = `${accessKeyId.slice(0, 8)}… @ ${region}`
    const id = await stsGetCallerIdentity(credentials)
    if (id.ok && (id.arn || id.account)) {
      const short =
        id.arn?.replace(/^arn:aws:iam::\d+:/, '') ||
        id.arn?.split('/').pop() ||
        id.account ||
        accessKeyId.slice(0, 8)
      accountLabel = `${short} @ ${region}`
    }

    const tokens: StoredTokens = {
      accessToken: secretAccessKey,
      accessKeyId,
      region,
      sessionToken,
      tokenType: 'aws_iam',
      scope: 'codecommit',
      accountLabel,
      updatedAt: Date.now()
    }
    saveTokens('codecommit', tokens)
    return { ok: true, accountLabel }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function disconnectCodeCommit(): void {
  clearTokens('codecommit')
}
