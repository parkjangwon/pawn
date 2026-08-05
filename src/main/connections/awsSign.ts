/**
 * Minimal AWS Signature Version 4 for CodeCommit (and STS) JSON/query APIs.
 * No AWS SDK dependency — tokens never leave the process.
 */

import { createHash, createHmac } from 'crypto'

export type AwsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function amzDate(d = new Date()): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '')
  // 20240115T120000Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

function signingKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

export async function awsFetch(opts: {
  credentials: AwsCredentials
  service: string
  method?: string
  /** Host only, e.g. codecommit.ap-northeast-2.amazonaws.com */
  host: string
  path?: string
  /** Extra headers (lowercased keys preferred). */
  headers?: Record<string, string>
  body?: string
  /** Query string without leading ? */
  query?: string
}): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const method = (opts.method || 'POST').toUpperCase()
  const path = opts.path || '/'
  const body = opts.body ?? ''
  const { amzDate: amz, dateStamp } = amzDate()
  const region = opts.credentials.region
  const service = opts.service
  const host = opts.host

  const headers: Record<string, string> = {
    host,
    'x-amz-date': amz,
    ...(opts.headers || {})
  }
  if (opts.credentials.sessionToken) {
    headers['x-amz-security-token'] = opts.credentials.sessionToken
  }
  if (body && !headers['content-type'] && !headers['Content-Type']) {
    headers['content-type'] = 'application/x-amz-json-1.1'
  }

  // Canonical headers: lowercase, sorted, trimmed
  const canonicalHeaderEntries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))

  const signedHeaderNames = canonicalHeaderEntries.map(([k]) => k)
  const canonicalHeaders =
    canonicalHeaderEntries.map(([k, v]) => `${k}:${v}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')
  const payloadHash = sha256Hex(body)
  const canonicalQuery = opts.query || ''

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')

  const key = signingKey(
    opts.credentials.secretAccessKey,
    dateStamp,
    region,
    service
  )
  const signature = createHmac('sha256', key)
    .update(stringToSign, 'utf8')
    .digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const url = `https://${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`
  const fetchHeaders: Record<string, string> = {
    ...Object.fromEntries(canonicalHeaderEntries),
    Authorization: authorization
  }
  // host is set by fetch from URL; remove to avoid mismatch issues in some runtimes
  delete fetchHeaders.host

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : body
  })
  const text = await res.text().catch(() => '')
  let parsed: unknown = text
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { text }
    }
  } else {
    parsed = {}
  }
  return { ok: res.ok, status: res.status, body: parsed, text }
}

/** CodeCommit JSON 1.1 target header helper. */
export async function codecommitApi(
  credentials: AwsCredentials,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const host = `codecommit.${credentials.region}.amazonaws.com`
  const body = JSON.stringify(payload)
  return awsFetch({
    credentials,
    service: 'codecommit',
    host,
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `CodeCommit_20150413.${action}`
    },
    body
  })
}

/** STS GetCallerIdentity for account label. */
export async function stsGetCallerIdentity(
  credentials: AwsCredentials
): Promise<{ ok: boolean; status: number; account?: string; arn?: string; userId?: string; error?: string }> {
  const host = 'sts.amazonaws.com'
  // STS is often called in us-east-1 for global endpoint; use credential region for regional STS.
  const region = credentials.region || 'us-east-1'
  const query =
    'Action=GetCallerIdentity&Version=2011-06-15'
  // Regional STS endpoint
  const regionalHost = region === 'us-east-1' ? host : `sts.${region}.amazonaws.com`
  const res = await awsFetch({
    credentials: { ...credentials, region },
    service: 'sts',
    method: 'POST',
    host: regionalHost,
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
    },
    body: query
  })
  if (!res.ok) {
    const err =
      typeof res.body === 'object' && res.body
        ? JSON.stringify(res.body)
        : res.text
    return { ok: false, status: res.status, error: err || `STS failed (${res.status})` }
  }
  // Response is XML
  const xml = res.text || ''
  const account = xml.match(/<Account>([^<]+)<\/Account>/)?.[1]
  const arn = xml.match(/<Arn>([^<]+)<\/Arn>/)?.[1]
  const userId = xml.match(/<UserId>([^<]+)<\/UserId>/)?.[1]
  if (!account && !arn) {
    // Sometimes JSON error body
    return { ok: false, status: res.status, error: 'Could not parse STS identity' }
  }
  return { ok: true, status: res.status, account, arn, userId }
}
