// Stage geometry: the item's box fitted into the stage (never upscaled past
// its own pixels), and its size at a zoom level. Pure, so it is tested in
// Node.

/** What the stage knows about an item's shape. */
export interface Shape {
  kind: string
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/**
 * Width / height for the stage: a document of unknown size is a portrait
 * page, a video of unknown size 16:9.
 */
function aspectOf(shape: Shape): number {
  const unknown = !shape.width || !shape.height
  if (shape.kind === 'document' && unknown) {
    return 3 / 4
  }
  if (shape.kind === 'video' && unknown) {
    return 16 / 9
  }
  if (shape.width > 0 && shape.height > 0) {
    return shape.width / shape.height
  }
  return 1
}

/**
 * The largest box with the item's aspect ratio inside `maxWidth` ×
 * `maxHeight`, but no larger than the item's own pixels (a small image stays
 * small, as in the prototype). Unknown sizes fill the box as a square.
 */
export function fitInto(
  shape: Shape,
  maxWidth: number,
  maxHeight: number,
): Size {
  if (maxWidth <= 0 || maxHeight <= 0) {
    return { width: 0, height: 0 }
  }
  const aspect = aspectOf(shape)
  let width = maxWidth
  let height = width / aspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }
  if (shape.width > 0 && shape.height > 0 && width > shape.width) {
    width = shape.width
    height = shape.height
  }
  return { width: Math.round(width), height: Math.round(height) }
}

/** The item at `zoom` × its own pixel size (100 % = 1). */
export function zoomedSize(shape: Shape, zoom: number): Size {
  const width = shape.width > 0 ? shape.width : 1000
  const height = shape.height > 0 ? shape.height : width / aspectOf(shape)
  return { width: Math.round(width * zoom), height: Math.round(height * zoom) }
}

/**
 * The scale a box shows the item at, relative to its own pixels (1 = 100 %).
 * Unknown sizes count as shown at 100 %.
 */
export function scaleOf(shape: Shape, size: Size): number {
  return shape.width > 0 ? size.width / shape.width : 1
}
