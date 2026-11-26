import { describe, expect, it } from 'vitest'
import type { ImageSource } from '../../../../../shared/library-api'
import {
  pickSource,
  pictureFor,
  type RenditionItem,
  smallestPictureFor,
  withVersion,
} from './renditions'

const sources: ImageSource[] = [
  { url: 'https://example.com/a-300x200.jpg', width: 300, height: 200 },
  { url: 'https://example.com/a-768x512.jpg', width: 768, height: 512 },
  { url: 'https://example.com/a-1536x1024.jpg', width: 1536, height: 1024 },
  { url: 'https://example.com/a.jpg', width: 3000, height: 2000 },
]

function item(overrides: Partial<RenditionItem> = {}): RenditionItem {
  return {
    kind: 'image',
    mime: 'image/jpeg',
    url: 'https://example.com/a.jpg',
    width: 3000,
    height: 2000,
    srcset: sources,
    thumb: {
      url: 'https://example.com/a-150x150.jpg',
      width: 150,
      height: 150,
    },
    poster: null,
    modifiedAt: '2026-11-20T10:00:00Z',
    ...overrides,
  }
}

describe('pickSource', () => {
  it('takes the smallest source that covers the box at the pixel ratio', () => {
    expect(pickSource(sources, 200, 133)?.width).toBe(300)
    expect(pickSource(sources, 200, 133, 2)?.width).toBe(768)
    expect(pickSource(sources, 1000, 600)?.width).toBe(1536)
  })

  it('falls back to the largest, and to null without sources', () => {
    expect(pickSource(sources, 5000, 4000)?.width).toBe(3000)
    expect(pickSource([], 10, 10)).toBeNull()
  })
})

describe('pictureFor', () => {
  it('versions the URL with modifiedAt (D19 cache busting)', () => {
    expect(
      withVersion('https://example.com/a.jpg', '2026-11-20T10:00:00Z'),
    ).toBe('https://example.com/a.jpg?v=2026-11-20T10%3A00%3A00Z')
    expect(withVersion('https://example.com/a.jpg?x=1', 'm')).toBe(
      'https://example.com/a.jpg?x=1&v=m',
    )
  })

  it('picks an image rendition, never the crop', () => {
    expect(pictureFor(item(), 250, 160)).toBe(
      withVersion('https://example.com/a-300x200.jpg', '2026-11-20T10:00:00Z'),
    )
    expect(smallestPictureFor(item())).toContain('a-300x200.jpg')
  })

  it('shows an SVG as its own file, and video by its poster', () => {
    expect(
      pictureFor(
        item({ kind: 'svg', url: 'https://example.com/logo.svg' }),
        10,
        10,
      ),
    ).toContain('logo.svg')
    expect(
      pictureFor(
        item({
          kind: 'video',
          srcset: [],
          thumb: null,
          poster: {
            url: 'https://example.com/poster.jpg',
            width: 640,
            height: 360,
          },
        }),
        200,
        120,
      ),
    ).toContain('poster.jpg')
  })

  it('has no picture for an archive without a cover', () => {
    expect(
      pictureFor(item({ kind: 'archive', srcset: [], thumb: null }), 100, 100),
    ).toBeNull()
  })
})
