// One polite live region for the whole app (interaction-spec §10): selection
// counts, mode changes, saves and toasts all go through announce(). The
// region itself is <LiveRegion/> (liveRegion.tsx), mounted once by the app.

type AnnouncementListener = (message: string) => void

const listeners = new Set<AnnouncementListener>()

/** Speaks `message` politely. Repeating the same text announces it again. */
export function announce(message: string): void {
  const text = message.trim()
  if (text === '') {
    return
  }
  for (const listener of listeners) {
    listener(text)
  }
}

export function subscribeAnnouncements(
  listener: AnnouncementListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** "1 item" / "3 items": counts in announcements and toasts. */
export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count.toLocaleString('en')} ${count === 1 ? singular : pluralForm}`
}
