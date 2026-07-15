import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Single-user session auth: a login password issues a signed, expiring
 * session token (the cookie value); agents authenticate per-request with a
 * static bearer token instead. No user table, no external identity — the
 * whole point of self-hosting one person's notes.
 *
 * Tokens are `exp.hmac(exp)` with the HMAC keyed off the password's hash, so
 * changing the password invalidates every outstanding session at once.
 */
export interface SessionAuth {
  /** Constant-time check of a login attempt against the configured password. */
  checkPassword: (attempt: string) => boolean
  /** Mint a session token valid for `ttlMs`. */
  issueSession: (ttlMs: number) => string
  /** True when `token` is well-formed, correctly signed, and unexpired. */
  verifySession: (token: string) => boolean
  /** Constant-time check of a bearer token against the agent token (if set). */
  checkAgentToken: (attempt: string) => boolean
}

function constantTimeEquals(expected: string, attempt: string): boolean {
  // Hash both sides first: equal-length digests make timingSafeEqual usable
  // without leaking the expected value's length.
  const expectedDigest = createHash('sha256').update(expected).digest()
  const attemptDigest = createHash('sha256').update(attempt).digest()
  return timingSafeEqual(expectedDigest, attemptDigest)
}

export function createSessionAuth(password: string, agentToken: string | null): SessionAuth {
  const sessionKey = createHash('sha256').update(`reflect-server-session:${password}`).digest()
  const sign = (payload: string): string =>
    createHmac('sha256', sessionKey).update(payload).digest('hex')

  return {
    checkPassword: (attempt) => constantTimeEquals(password, attempt),
    issueSession: (ttlMs) => {
      const expiresMs = Date.now() + ttlMs
      return `${expiresMs}.${sign(String(expiresMs))}`
    },
    verifySession: (token) => {
      const [expiresRaw, signature] = token.split('.')
      if (expiresRaw === undefined || signature === undefined) {
        return false
      }
      const expiresMs = Number(expiresRaw)
      if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
        return false
      }
      return constantTimeEquals(sign(expiresRaw), signature)
    },
    checkAgentToken: (attempt) =>
      agentToken !== null && attempt !== '' && constantTimeEquals(agentToken, attempt),
  }
}
