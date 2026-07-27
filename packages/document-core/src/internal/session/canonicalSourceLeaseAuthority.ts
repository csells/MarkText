import type { CanonicalSourceLease } from '../../documentSession.js'

const authenticLeases = new WeakSet<CanonicalSourceLease>()

export function authenticateCanonicalSourceLease<
  Lease extends CanonicalSourceLease
>(lease: Lease): Lease {
  authenticLeases.add(lease)
  return lease
}

export function isAuthenticCanonicalSourceLease(
  value: unknown
): value is CanonicalSourceLease {
  return (
    value !== null &&
    typeof value === 'object' &&
    authenticLeases.has(value as CanonicalSourceLease)
  )
}
