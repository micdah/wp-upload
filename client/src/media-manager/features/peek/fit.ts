// Quick peek's picture size (interaction-spec §4, prototype `peek.js`): the
// item fitted into 86 % of the centre's width and 80 % of its height (the
// caption pill sits below it), keeping its aspect ratio and never upscaled
// past its own pixels. Pure, so it is unit-tested.

export const PEEK_MAX_WIDTH = 0.86
export const PEEK_MAX_HEIGHT = 0.8

/** The box for items without a picture (cards). */
export const PEEK_CARD_SIZE = 280

export interface Size {
  width: number
  height: number
}

/**
 * The picture's size in CSS px inside a centre area of `area`. `item` is
 * the item's pixel size; 0 (unknown) fills the area as a square-ish box.
 */
export function peekSize(item: Size, area: Size): Size {
  const maxWidth = Math.max(0, area.width * PEEK_MAX_WIDTH)
  const maxHeight = Math.max(0, area.height * PEEK_MAX_HEIGHT)
  const known = item.width > 0 && item.height > 0
  const ratio = known ? item.width / item.height : 1
  let width = known ? Math.min(maxWidth, item.width) : maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return { width: Math.round(width), height: Math.round(height) }
}

/** "beach-panorama…-final.jpg": the middle goes, the extension stays. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
