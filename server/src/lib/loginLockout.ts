// Per-IP login lockout: MAX_FAILURES wrong logins within WINDOW_MS lock the
// IP out until the window has passed. Keyed on req.ip, so TRUST_PROXY decides
// which X-Forwarded-For entry counts as the client.

export const MAX_FAILURES = 10
export const WINDOW_MS = 5 * 60 * 1000

// IP -> { count, windowStart }. In-memory is fine for a single-process,
// single-instance app; a restart just resets the lockout. Exported (not
// module-private) so specs can assert on it directly.
//
// sweepExpired() prunes stale entries on every login attempt, not just when
// the same IP happens to come back - otherwise an IP that fails once and
// never returns would sit here for the life of the process (see #3).
export const failures = new Map<
  string,
  { count: number; windowStart: number }
>()

export function isLockedOut(ip: string): boolean {
  const entry = failures.get(ip)
  if (!entry) return false
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    failures.delete(ip)
    return false
  }
  return entry.count >= MAX_FAILURES
}

export function recordFailure(ip: string): void {
  const entry = failures.get(ip)
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: Date.now() })
  } else {
    entry.count += 1
  }
}

export function clearFailures(ip: string): void {
  failures.delete(ip)
}

export function sweepExpired(): void {
  const now = Date.now()
  for (const [ip, entry] of failures) {
    if (now - entry.windowStart > WINDOW_MS) failures.delete(ip)
  }
}

// Seconds until a locked-out IP may try again, for the Retry-After header.
export function retryAfterSeconds(ip: string): number {
  const entry = failures.get(ip)
  if (!entry) return 0
  const remainingMs = entry.windowStart + WINDOW_MS - Date.now()
  return Math.max(1, Math.ceil(remainingMs / 1000))
}
