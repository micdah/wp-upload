import { describe, expect, it } from 'vitest'
import { folderTree } from '../../../../../../shared/fixtures/folders'
import type { ExifInfo } from '../../../../../../shared/library-api'
import {
  absoluteUrl,
  dimensions,
  exposureLine,
  folderPath,
  formatDate,
  formatDuration,
  hasCameraInfo,
  hasSizes,
  mediaLine,
  sizeLabel,
} from './details'

const EMPTY_EXIF: ExifInfo = {
  camera: null,
  lens: null,
  focalLength: null,
  aperture: null,
  shutter: null,
  iso: null,
  takenAt: null,
  credit: null,
  copyright: null,
  keywords: [],
}

describe('sizeLabel', () => {
  it('names the built-in sizes', () => {
    expect(sizeLabel('thumbnail', false)).toBe('Thumbnail')
    expect(sizeLabel('medium', false)).toBe('Medium')
    expect(sizeLabel('medium_large', false)).toBe('Medium large')
    expect(sizeLabel('large', false)).toBe('Large')
  })

  it('says whether the full size was scaled', () => {
    expect(sizeLabel('full', false)).toBe('Full size')
    expect(sizeLabel('full', true)).toBe('Full (scaled)')
  })

  it('makes other names readable', () => {
    expect(sizeLabel('1536x1536', false)).toBe('1536 × 1536')
    expect(sizeLabel('2048x2048', true)).toBe('2048 × 2048')
    expect(sizeLabel('post-thumbnail', false)).toBe('Post thumbnail')
    expect(sizeLabel('woocommerce_gallery_thumbnail', false)).toBe(
      'Woocommerce gallery thumbnail',
    )
    expect(sizeLabel('hero_1200x600', false)).toBe('Hero 1200 × 600')
  })

  it('keeps a name it cannot make readable', () => {
    expect(sizeLabel('__', false)).toBe('__')
  })
})

describe('dimensions', () => {
  it('formats known sizes only', () => {
    expect(dimensions(1572, 1179)).toBe('1572 × 1179')
    expect(dimensions(0, 1179)).toBeNull()
    expect(dimensions(1572, 0)).toBeNull()
  })
})

describe('formatDate', () => {
  it('writes day, short month and year', () => {
    expect(formatDate('2025-01-11T12:00:00Z')).toBe('11 Jan 2025')
    expect(formatDate('2026-09-15T12:00:00Z')).toBe('15 Sep 2026')
  })

  it('returns an empty string for nonsense', () => {
    expect(formatDate('not a date')).toBe('')
  })
})

describe('formatDuration', () => {
  it('writes m:ss, and h:mm:ss from an hour on', () => {
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(94)).toBe('1:34')
    expect(formatDuration(94.6)).toBe('1:35')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(-3)).toBe('0:00')
  })
})

describe('exposureLine', () => {
  it('joins focal length, aperture, shutter and ISO', () => {
    expect(
      exposureLine({
        ...EMPTY_EXIF,
        focalLength: 70,
        aperture: 4,
        shutter: '1/1000',
        iso: 200,
      }),
    ).toBe('70 mm · f/4 · 1/1000 s · ISO 200')
  })

  it('rounds to one decimal and keeps a shutter in seconds', () => {
    expect(
      exposureLine({
        ...EMPTY_EXIF,
        focalLength: 6.86,
        aperture: 1.78,
        shutter: '2s',
      }),
    ).toBe('6.9 mm · f/1.8 · 2s')
  })

  it('skips unknown parts, and is null with none', () => {
    expect(exposureLine({ ...EMPTY_EXIF, iso: 400 })).toBe('ISO 400')
    expect(exposureLine({ ...EMPTY_EXIF, aperture: 0, shutter: ' ' })).toBe(
      null,
    )
    expect(exposureLine(EMPTY_EXIF)).toBeNull()
  })
})

describe('hasCameraInfo', () => {
  it('needs at least one shown value', () => {
    expect(hasCameraInfo(null)).toBe(false)
    expect(hasCameraInfo(EMPTY_EXIF)).toBe(false)
    expect(hasCameraInfo({ ...EMPTY_EXIF, credit: 'Someone' })).toBe(false)
    expect(hasCameraInfo({ ...EMPTY_EXIF, camera: 'X100V' })).toBe(true)
    expect(hasCameraInfo({ ...EMPTY_EXIF, iso: 100 })).toBe(true)
    expect(
      hasCameraInfo({ ...EMPTY_EXIF, takenAt: '2025-04-06T05:43:26Z' }),
    ).toBe(true)
  })
})

describe('mediaLine', () => {
  it('describes a video', () => {
    expect(
      mediaLine({
        format: 'mp4',
        codec: 'h264',
        bitrate: 4102128,
        sampleRate: 48000,
        channels: 2,
      }),
    ).toBe('MP4 · h264 · 4.1 Mbps · 48 kHz stereo')
  })

  it('skips a codec equal to the format, and unknown parts', () => {
    expect(
      mediaLine({
        format: 'mp3',
        codec: 'mp3',
        bitrate: 128000,
        sampleRate: 44100,
        channels: 1,
      }),
    ).toBe('MP3 · 128 kbps · 44.1 kHz mono')
    expect(
      mediaLine({
        format: null,
        codec: null,
        bitrate: null,
        sampleRate: null,
        channels: 6,
      }),
    ).toBe('6 channels')
  })

  it('is null without anything known', () => {
    expect(mediaLine(null)).toBeNull()
    expect(
      mediaLine({
        format: null,
        codec: null,
        bitrate: null,
        sampleRate: null,
        channels: null,
      }),
    ).toBeNull()
  })
})

describe('folderPath', () => {
  const folders = folderTree.folders

  it('walks up to the top level', () => {
    expect(folderPath(folders, 5)).toBe('Blog / 2025')
    expect(folderPath(folders, 12)).toBe('Products / Outdoor')
    expect(folderPath(folders, 1)).toBe('Brand')
  })

  it('calls 0 Uncategorized and an unknown id null', () => {
    expect(folderPath(folders, 0)).toBe('Uncategorized')
    expect(folderPath([], 0)).toBe('Uncategorized')
    expect(folderPath(folders, 999)).toBeNull()
  })

  it('stops at a broken parent chain', () => {
    const base = { ord: 0, color: null, count: 0 }
    expect(
      folderPath(
        [
          { ...base, id: 2, name: 'A', parent: 3 },
          { ...base, id: 3, name: 'B', parent: 2 },
        ],
        2,
      ),
    ).toBe('B / A')
    expect(folderPath([{ ...base, id: 2, name: 'A', parent: 77 }], 2)).toBe('A')
  })
})

describe('hasSizes', () => {
  it('is for raster images with sizes', () => {
    const size = {
      name: 'full',
      url: 'https://example.com/a.jpg',
      width: 1,
      height: 1,
      mime: 'image/jpeg',
      filesize: 1,
    }
    expect(hasSizes({ kind: 'image', sizes: [size] })).toBe(true)
    expect(hasSizes({ kind: 'image', sizes: [] })).toBe(false)
    expect(hasSizes({ kind: 'svg', sizes: [size] })).toBe(false)
    expect(hasSizes({ kind: 'document', sizes: [size] })).toBe(false)
  })
})

describe('absoluteUrl', () => {
  it('keeps absolute URLs and resolves relative ones', () => {
    const base = 'https://app.example.com/wp-upload/'
    expect(absoluteUrl('https://example.com/a.jpg?x=1', base)).toBe(
      'https://example.com/a.jpg?x=1',
    )
    expect(absoluteUrl('/wp-content/a.jpg', base)).toBe(
      'https://app.example.com/wp-content/a.jpg',
    )
  })
})
