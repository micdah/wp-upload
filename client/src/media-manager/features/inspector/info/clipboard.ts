// Writing to the clipboard (inspector.md §9 "Clipboard unavailable"). The
// async Clipboard API is missing on plain-HTTP origins and in some embeds, and
// it rejects without a user gesture or permission; callers then fall back to
// selecting the text so the user can copy it by hand.

/** The part of `navigator.clipboard` used here. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>
}

function browserClipboard(): ClipboardLike | null {
  if (typeof navigator === 'undefined') {
    return null
  }
  return navigator.clipboard ?? null
}

/** Copies `text`; resolves to whether it reached the clipboard. */
export async function copyText(
  text: string,
  clipboard: ClipboardLike | null = browserClipboard(),
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return false
  }
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const COPIED_MESSAGE = 'URL copied'
export const COPY_BY_HAND_MESSAGE = 'Press Ctrl+C or Cmd+C to copy'
/** How long a Copy button says "Copied". */
export const COPIED_MS = 1500
