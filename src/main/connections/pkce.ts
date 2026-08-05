import { createHash, randomBytes } from 'crypto'

export function randomString(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
