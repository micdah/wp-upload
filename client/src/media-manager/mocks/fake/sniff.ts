// Image dimensions from a file's first bytes (PNG, GIF, JPEG, WebP), so an
// uploaded image lays out with its real aspect ratio in the mock. Anything
// else reads as 0 × 0 (unknown), like an item WordPress hasn't measured.

export function sniffDimensions(bytes: Uint8Array): {
  width: number
  height: number
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const at = (offset: number) => bytes[offset] ?? 0
  // PNG: signature, then IHDR width/height (big-endian).
  if (
    bytes.length >= 24 &&
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // GIF: "GIF8", logical screen width/height (little-endian).
  if (
    bytes.length >= 10 &&
    at(0) === 0x47 &&
    at(1) === 0x49 &&
    at(2) === 0x46
  ) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  // WebP: RIFF....WEBP with a VP8X, VP8 or VP8L chunk.
  if (
    bytes.length >= 30 &&
    at(0) === 0x52 &&
    at(8) === 0x57 &&
    at(9) === 0x45
  ) {
    const chunk = String.fromCharCode(at(12), at(13), at(14), at(15))
    if (chunk === 'VP8X') {
      return {
        width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)),
        height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)),
      }
    }
    if (chunk === 'VP8 ') {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      }
    }
    if (chunk === 'VP8L') {
      const packed = view.getUint32(21, true)
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >> 14) & 0x3fff) + 1,
      }
    }
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (bytes.length >= 4 && at(0) === 0xff && at(1) === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (at(offset) !== 0xff) {
        offset++
        continue
      }
      const marker = at(offset + 1)
      const length = view.getUint16(offset + 2)
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      if (isFrame) {
        return {
          width: view.getUint16(offset + 7),
          height: view.getUint16(offset + 5),
        }
      }
      offset += 2 + length
    }
  }
  return { width: 0, height: 0 }
}
