// What a logout drops besides the library data (the query cache): app and
// feature state that belongs to the session that ended, so the next login
// never sees the previous user's selection, drafts or pending errors, and a
// save still in flight can't toast over the login screen.
//
// Core resets its own state; a feature with a store of its own joins from
// its register():
//
//     onSessionReset(() => myStore.setState(INITIAL))
//
// AuthGate calls resetSession() after a confirmed logout.

type Reset = () => void

const resets = new Set<Reset>()

/** Runs `reset` on every logout; returns the unregister function. */
export function onSessionReset(reset: Reset): () => void {
  resets.add(reset)
  return () => {
    resets.delete(reset)
  }
}

/** Runs every registered reset (a failing one doesn't stop the others). */
export function resetSession(): void {
  for (const reset of [...resets]) {
    try {
      reset()
    } catch (error) {
      console.error('A session reset failed', error)
    }
  }
}
